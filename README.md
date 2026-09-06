# ProofBoundary — Verified / TCB 分離 TODO API（PoC）

検証したい問い: **AIが生成するアプリケーションコードを機械的に検証可能なコードとして扱い、人間がレビューすべきコードを小さなTCBだけに限定できるか。**

このリポジトリは良いWebアプリを目指していません。目指すのは一点のみです。
すなわち、**何が証明されていて、何が単なる信頼なのか、そしてその違いを機械がどう検査するのか**を曖昧さなく示すことです。
実装前に固めた判断は [`DESIGN.md`](DESIGN.md) にあります。
検証がどう行われ、なぜ「人間が実装diffを読まなくてよい」と言えるのかの根拠は
[`VERIFICATION.md`](VERIFICATION.md) にまとめています。

## 準備（ホストに必要なのは Docker + Compose のみ）

```bash
docker compose build
docker compose up            # APIは http://localhost:3000（PostgreSQLはcompose内）
docker compose run --rm app npm run verify   # フル検証（CIの入口）
docker compose run --rm app npm test          # テストのみ
docker compose run --rm app npm run metrics   # Verified LOC vs TCB LOC
```

`make verify | make test | make up` でも同じ操作ができます（任意のラッパーです）。

```bash
curl -X POST localhost:3000/todos -H 'content-type: application/json' -d '{"title":"first"}'
curl localhost:3000/todos
ID=<上で得たid>
curl -X POST localhost:3000/todos/$ID/complete
```

## アーキテクチャ

```text
HTTP JSON
  ↓  パース（正体不明のバイト列）
TCBアダプタ (src/tcb/http/server.ts)
  ↓  実行時検証（zod: unknown → 信頼済みドメイン値）
Verifiedユースケース (src/verified/usecases/todos.ts)
  ↓  純粋ドメイン呼び出し ＋ Port呼び出し
リポジトリContract (src/verified/contracts/todoRepository.ts — interfaceのみ）
  ↓  TCB DBアダプタ (src/tcb/db/pgTodoRepository.ts)
PostgreSQL
```

どのファイルがVerifiedでどれがTCBかは**機械的に判定**します。
`src/verified/**` 配下はすべてサブセット検査＋境界検査を通過しなければならず、
それ以外のアプリケーション側は構造上すべてTCBになります。

## 信頼モデル

| 領域 | ファイル | 保証内容 |
|---|---|---|
| Verified Tier 1（SMTで証明） | `src/verified/domain/todo.ts` | ContractをZ3が**全入力**について証明（UNSAT） |
| Verified Tier 2（検査＋テスト） | `src/verified/contracts/`、`src/verified/usecases/` | サブセット＋境界検査済み、単体テスト済み。永続化はPort経由で**仮定** |
| TCB（信頼、人手レビュー対象） | `src/tcb/**`、`tools/**` | 小さく、ロジックなしに保つ。下表に列挙 |
| 信頼する基盤 | Node.js、PostgreSQL、`pg`、`zod`、`z3-solver`、`tsc` | 正しいと仮定（非保証を参照） |

Verified Codeが外界に触れる経路はPort（`TodoRepository`）のみです。
TCB側では業務判断を行いません（Verified Codeの外に `if
(todo.completed)` は存在しない——HTTP層はユースケース結果をステータスコード
に対応付けるだけです）。

## 検証保証

`createTodo` について: `1 <= title.length <= 200` を満たす任意の入力に対し、
出力の `id`／`title` は入力と同一で `completed == false` になる。
`completeTodo` について: `completed == false` の任意の入力に対し、出力の
`id`／`title` は入力と同一で `completed == true` になる。フラグ反転だけでなく
**フィールド保存も**証明対象の postcondition に含まれます。証明器は
`Pre ∧ output=Impl ∧ ¬Post` の充足可能性をZ3のString/Bool/Int理論上で問い合わせます。
UNSAT＝全入力で成立、SAT＝モデルから得た入出力値を counterexample として表示します
（`npm run verify` の出力例を参照）。

`npm run verify` の各段階が保証するもの:

1. **型検査**（`tsc`）——ツリー全体が型正しいこと（必要条件であり十分条件ではない）。
2. **Verifiedサブセット検査**——Verifiedファイルが翻訳可能な断片のみを使うこと
   （`any`／`as`／`!`／`throw`／ループ／usecases外での`await`／クロージャ等を禁止）。
3. **import境界検査**——Verifiedファイルが `src/verified/**` の外をimportしないこと
   （`pg`／`zod`／`node:*`／グローバル変数を禁止）。
4. **境界セルフテスト**——検査器自体を、注入した違反（`zod`密輸、`fetch`、`as`キャスト）
   でテストする。見逃す検査器はビルド失敗になる。
5. **Contract検証**——2関数のZ3証明に加え、`fixtures/invalid/*`
   （意図的不正実装）が証明**されない**ことを要求する。
6. **テスト**——ドメイン、ユースケース（Portの偽実装使用）、HTTP対応付けの実行時挙動。

## 非保証（明示する仮定）

- PostgreSQLが行を正しく保存・返却すること。`pg` が正しくマッピングすること。
- TCBアダプタがPortのContractを実装していること（`save` は受け取ったものをそのまま永続化する）。
  zodスキーマがドメイ述語と一致していること（`min(1).max(200)`）。
- Node.js／HTTP転送が忠実であること。`z3-solver`（Z3 WASM）が正しく判定すること。
- 検査器・証明器が使う `tsc` のパースが正しいこと。
- 形式 postcondition が自然言語の要求の意味を捉えていること。

## TCB（アプリケーション側の全ファイル）

```text
src/tcb/http/server.ts            # ルーティング、ボディパース、状態対応付け（業務規則なし）
src/tcb/validation/todoSchemas.ts # zod境界: unknown → ドメイン値
src/tcb/db/pgTodoRepository.ts    # Port実装（対応付けは信頼対象であり証明対象外）
src/tcb/db/schema.ts              # DDL
src/tcb/runtime/main.ts           # 環境変数、プール、listen
tools/verifier/verify.mjs         # AST→Z3証明器（忠実な符号化を信頼）
tools/checks/subset.mjs           # サブセット検査器（信頼）
tools/checks/boundary.mjs         # 境界検査器（信頼）
tools/checks/selftest.mjs         # 検査器セルフテスト
tools/verify-all.mjs              # パイプライン配線
tools/metrics/metrics.mjs         # LOC計測
```

## 信頼サイズの測定（`npm run metrics`）

```text
Application code: 238 LOC
Verified:          69 LOC
TCB:              169 LOC
TCB ratio:         71.0%
```

3エンドポイントの玩具規模では比率が逆転して見えます。これはTCBがほぼ**固定の
インフラ分**（HTTPパース、SQL対応付け）であり、Verifiedが業務規則とともに伸びるためです。
運用上の主張は限界費用にあります。すなわち、ドメインロジック追加時のTCB増加はほぼゼロです。
固定部分の更なる縮小は、ハンドラの手書き削減ではなく、共有ライブラリ化・生成アダプタ化で
行うべきです（下記評価§8）。Webフレームワーク導入はこの数値を「改善」させますが実際の信頼は
増えるため、計測は自前の `src/` のみを対象にし、フレームワークは除外しています。

## 評価（10問への回答）

1. **TypeScriptのどの範囲が現実的に機械検証できたか。** `{string, boolean, number}`
   のオブジェクト形状に対する一階の純粋関数（`===`、`&&`、`||`、`!`、三項演算子、文字列
   `.length`）。状態遷移とコンストラクタ、すなわちCRUD業務ロジックの中核には十分でした。
2. **Verifiedサブセットに必要だった制約は。** `any`／`unknown`／`as`／`!`、I/O、
   async（ドメイン層）、ループ、例外、クロージャ、クラス、動的アクセス、ベアimportの全面禁止。
   翻訳はfail-closedです。モデル化できないものは黙って通さず必ずエラーにします。
3. **TCBに最終的に何が残ったか。** HTTPパース／ルーティング、zod検証、pgアダプタ＋DDL、
   プロセス配線、そして検証器ツールチェーン自体です。
4. **TCB比率は。** 71%（固定費支配。上記参照）。
5. **Verified Code変更時に人間がdiffを読まなくてよいか。** Tier 1の純粋関数についてははい、
   **ただし**人間はRequires/Ensuresの仕様を引き続きレビューします。証明は仕様に対する相対的なものだからです。
   これが正しい分業です。人間は「何が成り立つべきか」をレビューし、機械は「全入力で成り立つこと」を検査します。
6. **まだ人間が確認する必要があるものは。** 仕様、TCBファイル、スキーマと述語の対応
  （zodの境界値と `Requires`）、Portの仮定です。
7. **DB Contractの仮定はどの程度危険か。** 封じ込められています。アダプタは分岐なし約36行の
   素直な対応付けであり、危険な部分（SQL生成）は `pg` のパラメータ束縛に委譲し、読み出し行形状は
   zodで再検証しています。
8. **TCBをさらに縮小するには。** Verified interface からHTTP＋検証＋アダプタ層を**生成**する
   （生成器1個のレビューで済む）、または監査済みCRUDランタイムをサービス間で共有します。
9. **実開発への拡張で最大の障害は。** 仕様記述の執筆コストです。リッチなドメインに対する精密な
   pre/postcondition の作成と、実行時バリデータとドメイン述語の同期維持（現状は目視で信頼）が課題です。
10. **AI生成→counterexample→自己修正ループに発展できるか。** はい。このPoCは既に必要な信号を
    出しています。すなわち機械可読な合否＋具体的な入出力 counterexample（mutation出力を参照）です。
    次の段階はそのテキストを生成器に返すことであり、新しい検証機構は不要です。
