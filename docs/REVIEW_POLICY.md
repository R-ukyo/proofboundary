# レビューポリシー — 人間が読むPRと機械だけで通すPRの分け方

## 原則

変更ファイルのパスだけを見て、次のどちらかに分類します。
内容の難しさや差分の大きさは判断材料にしません。

- **MACHINE_ONLY**: `src/verified/impl/**` と `tests/**` のみ。
  パイプライン（`npm run verify`）が緑なら、人間は読まずにマージしてよい。
- **NEEDS_HUMAN**: それ以外のファイルを1つでも含む変更。
  人間レビューが必須。`CODEOWNERS` が対象者を指名する。

## なぜこの分類で足りるのか

- `src/verified/impl/**` の正しさは、仕様に対するZ3証明が全入力について決定します。
  実装diffの読み落としは起こり得ません。読み落とし得るのは仕様の側であり、
  仕様は `src/verified/specs/**` として別ファイルにあり、必ずNEEDS_HUMANになります。
- `src/verified/impl/**` が仕様をすり替えることは構造的にできません。
  証明器はspecs側の `*Requires`／`*Ensures` を正として読み、impl側の同名再定義は
  重複エラー（fail-closed）で落とします。
- `tests/**` は「実行されるもの」であり「信頼するもの」ではありません。
  間違ったテストは正しい実装に対して赤になります。Tier 1の意味的 backstop は
  常にZ3証明です。
- 上記以外（specs、contracts、usecases、TCB、tools、fixtures、docs、CI設定）は
  すべて信頼に関わるため人間が読みます。特に `tools/verifier/verify.mjs` の
  TARGETS登録（証明対象の指定）はTCBであり、関数追加時は人間PRに含めます。

## 運用（CI）

`.github/workflows/verify.yml` が全PRで次を行います。

1. `docker compose run --rm app npm run verify`（フル検証）。
2. `tools/review-gate/review-gate.mjs` で changed files を分類。
3. MACHINE_ONLY → `machine-only` ラベル＋auto-merge（squash）。
   NEEDS_HUMAN → `needs-human-review` ラベル。

ローカル確認: `git diff --name-only origin/main...HEAD` の結果を渡して
`node tools/review-gate/review-gate.mjs --files <list>` を実行します
（Nodeがないホストでは `docker compose run --rm app` 経由）。

## stack運用（gh-stack）

機能追加は「人間PR → 機械PR → 人間PR」のstackに分割します（例: reopen）。

1. **人間PR（bottom）**: `specs` への仕様追加 ＋ TARGETS登録 ＋ 不正fixture（negative control）。
   レビュー観点は「reopenの定義はこれでよいか」の1点。
2. **機械PR（middle）**: `impl` への実装 ＋ `tests`。
   CIが緑なら人間は読まない。spec変更を含められないため定義のすり替えは不可。
3. **人間PR（top）**: `usecases` ＋ TCBルート ＋ 配線テスト。
   レビュー観点は「状態対応付けに業務判断が混ざっていないか」。

`gh stack submit` で3件のPRとして提出し、下から順にマージします。
機械PRのマージはauto-mergeに任せられます。

## stackマージ順序の規則

stack PRのマージは非同期APIがサブスタック全体を下から潰すため、次の順序を守ります。

1. 人間PR（bottom）→ 人間がレビューしてマージ。
2. 人間PRのマージ後、`gh stack sync` で残りstackをリベースし直す（CI再実行）。
3. 機械PRがstack底辺（position 1）に来た段階のCIで、検証緑＋MACHINE_ONLYなら
   CIがそのままマージする。人間は `machine-only` ラベルを確認するだけ。
4. 人間PR（top）→ 人間がレビューしてマージ。

CIの機械マージ段は、stack底辺でないPR（position != 1）に対してはマージ要求を
出さず、ラベルのみ残して成功終了します。これにより、機械PRが未レビューの人間PRを
巻き添えマージすることを防ぎます。
