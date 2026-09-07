# 設計メモ — Verified / TCB 分離 PoC（TODO API）

日付: 2026-09-06。実装前に決定した。本メモが仕様であり、コードはこれに従う。

## 1. Verifiedサブセット（機械的に強制）

対象: `src/verified/**` のみ。原則: **SMTに翻訳できないものはここに置けない。**

許可:
- フィールドが `string | boolean | number` のみの `interface`／`type`。
- `export function f(args: T): U { ... }` ——同期のみ、単一 `return`（直前に純粋式の `const`束縛可）。
- 純粋式のみ: オブジェクトリテラル `{...}`、スプレッド `...x`、プロパティアクセス `a.b`、
  `===`、`!==`、`&&`、`||`、`!`、リテラル、三項演算子 `?:`、文字列 `.length`、数値比較 `< <= > >=`。
- `src/verified/**` 内の相対importのみ（`import type` または純粋ヘルパーの値import）。ベア指定子のimportは全面禁止。

禁止（サブセット検査でビルド失敗）:
- `any`、`unknown`、`as`、`!`（non-null assertion）、`eval`、`Function`、`Proxy`、`Reflect`
- `async`／`await`、`Promise`、`throw`／`try`／`catch`、`for`／`while`／`do`、
  `let`／`var` 再代入（`const` のみ）、`class`／`this`／`new`、`enum`
- `fetch`、`process`、`fs`、`path`、`console`、`Date.now`、`Math.random`、`crypto`、`setTimeout`
- 動的アクセス `a[b]`、`Object.keys/assign`、`any` のスプレッド、再帰、トップレベルの可変export（`let`）
- ベアimport: `pg`、`hono`、`express`、`fastify`、`zod`、`@prisma/*`、`drizzle*`、`node:*` ——
  Verified内のベアimportはすべて禁止。

理由: このサブセットはZ3理論（Bool、String、長さ用Int）に1対1で対応する。
それ以外は黙って未モデル化にせず拒否する。
ESLint的水準とソルバー水準の切り分け: 構文・禁止規則＝AST検査器（高速、ソルバー不要）、
Contractの意味的妥当性＝Z3（ソルバー必須）。

## 2. TCB境界

- Verified（`src/verified/`）:
  - `specs/todo.ts`（型＋ `*Requires`／`*Ensures` 仕様。**人間レビュー対象**。
    「正しいとは何か」の定義であり、変更は `NEEDS_HUMAN`）
  - `impl/todo.ts`（純粋関数の本体のみ。**機械検査対象**。証明が通れば人間は読まない。
    `docs/REVIEW_POLICY.md` 参照）
  - `contracts/todoRepository.ts`（Portのinterfaceのみ、実装なし）
  - `usecases/*.ts`（Port上のオーケストレーション。I/Oプリミティブなし——Portを引数で受け取る。
    Port待ちのためのみ `async` を許可）。
  - 注意: usecasesは境界検査＋型検査＋単体テストの対象であり、SMT証明の範囲は
    呼び出す純粋関数までに限る。SMTの適用範囲は純粋コアである。これはREADMEで限定保証として
    明示し、隠さない。
- TCB（`src/tcb/`）: `http/server.ts`（node:httpによるルーティング、パース／直列化のみ）、
  `validation/*`（zodスキーマ: unknown → 信頼済みドメイン値）、`db/pgTodoRepository.ts`
  （pgアダプタによるPort実装）、`runtime/*`（環境変数、main、接続配線）。TCBは `pg`、`zod`、
  `node:*` をimportしてよい。TCBに業務規則を書いてはならない（`if (todo.completed)` のような
  判断はなく、Verifiedユースケースを呼ぶだけ）。
- 検証器自体（`tools/verifier/`、`tools/checks/`）はTCBである。tsc、AST検査器、
  z3-solver（Z3 WASM）、Nodeを信頼する。READMEの仮定に列挙する。
- 機械的判定: `tools/checks/boundary.mjs`（依存なしの素のNode）が `src/verified/**` の
  import／識別子を走査し、違反があれば失敗させる。人手判断は介在しない。

## 3. 検証機構（型検査の演技ではなく、本物のSMT）

- `tools/verifier/verify.mjs` はTypeScriptコンパイラAPIで**実際の**
  Verifiedソース（`src/verified/specs/todo.ts`＋`src/verified/impl/todo.ts` の2ファイル。
  両者の定義結合は重複エラーでfail-closed）をパースする。対象の実装関数本体と
  Requires／Ensures仕様関数本体を取り出し、対応するASTノードを `z3-solver` の項に翻訳する。
- 理論: Bool＋String＋Int（文字列長）。`title.length` → `Length(title)`。
- 関数ごとの問い: `Pre(input) ∧ output = Impl(input) ∧ ¬Post(input, output)`。
  `unsat`＝証明成功、`sat`＝モデルを評価して `Counterexample: input.../ output...` を表示する。
- 翻訳はサブセット上 total である。未対応ASTノードは検証**エラー**（fail-closed）であり、
  決して読み飛ばさない。したがってサブセット外のコードをAIが生成しても黙って通ることはない。
- ネガティブコントロール: `fixtures/invalid/*.ts` にバグ入りコピー
  （例: `completed:false`、`title:""`）を置く。`npm run verify` は各fixtureにも証明器を走らせ、
  fixtureが検証を**通ったら**ビルド失敗にする（通ることではなく、誤実装の拒否を証明する）。

## 4. SMTソルバーの利用法

- Dockerイメージ内の `z3-solver` npmパッケージ（WASMにコンパイルされたZ3、本物のZ3決定手続き）。
  ホストのZ3不要、ネットワーク不要、Python不要。`Solver.check()` → `sat`／`unsat`。
  モデルから counterexample を得る。
- 検討したが不採用: システムZ3＋SMT-LIBファイル＋Python方式。イメージ肥大化に加え
  `npm run verify` 単一コマンドの筋が悪く、同等の決定能力しか得られないため。

## 4b. 生成による対応付け（バリデータ）

- HTTPボディ用zodスキーマは手書きしない。`tools/codegen/validators.mjs` が
  `*Input` 型を守る `Requires` の長さ境界値から生成する（現状 `CreateTodoBody`）。
  対応の正しさは目視ではなく構成で保証し、`npm run verify` 内の鮮度検査（`--check`）が
  driftを検出する。生成不能な述語があればfail-closedでエラーにする。
- 証明対象も手登録しない。`*Requires`／`*Ensures`／同名実装の組を命名規則で自動検出する。
  関数追加時に検証器の編集は不要であり、登録漏れ（＝証明されない関数の混入）は構造的に起きない。

## 5. Docker構成

- `Dockerfile`: `node:20-slim` 基盤、`npm ci`、リポジトリ複写、TSコンパイル。
  ホストのNode／npm／Z3は不要。
- `compose.yaml`: `app`（ビルド品）＋ `db`（`postgres:16-alpine`、名前付きボリューム、healthcheck）。
  接続は `DATABASE_URL` 経由。
- コマンド（すべてコンテナ側実行）: `docker compose build`、`docker compose up`、
  `docker compose run --rm app npm run verify|test|metrics`。Makefileは同一コマンドのラッパー（任意）。

## 6. 保証（UNSATが実際に意味するもの）

- 対象範囲内の全文字列・真偽値について: `Requires` が成り立てば、実装の出力は `Ensures` を
  満たす。`completed == true` だけでなく、フィールド保存条項
  （`output.id == input.id`、`output.title == input.title`）を含む。
- createTodo: 有効タイトルの入力 ⇒ タイトル透過 ＋ `completed == false`（＋id透過）。
- completeTodo: `completed == false` の入力 ⇒ id／タイトル保存 ＋ `completed == true`。

## 7. 非保証（明示する仮定）

Postgresが正しく動作する。pgドライバが行を忠実に対応付ける。zodバリデータがドメイン述語と
一致する。Node／http転送が忠実である。z3-solverが正しく判定する。
自然言語の要求（「completedは完了を意味する」）がEnsuresに正しく形式化されている。
DB永続化（`save` が渡されたものを保存する）はPortのContractによる**仮定**であり、証明しない。
ユースケースとPortの配線はテスト対象であり、SMT証明対象ではない。
