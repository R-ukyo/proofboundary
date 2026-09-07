// TCB — runtime validation boundary (hand-written part).
//
// CreateTodoBody is GENERATED from createTodoRequires
// (src/tcb/validation/generated/, via tools/codegen/validators.mjs), so the
// validator bounds match the domain predicates by construction.
// TodoIdParam/TodoRow are transport/storage concerns with no domain
// counterpart; they stay hand-written TCB.

import { z } from "zod";

export const TodoIdParam = z.string().min(1).max(200);

export const TodoRow = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
});
export type TodoRow = z.infer<typeof TodoRow>;
