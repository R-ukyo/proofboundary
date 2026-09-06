// TCB — runtime validation boundary.
//
// Every external value (HTTP body, URL param, DB row) is `unknown` until it
// passes one of these schemas. Only the schema OUTPUT (a trusted domain
// value) may enter Verified Code. The bounds below (min 1 / max 200) must
// match `createTodoRequires`; that correspondence is TRUSTED, not proved.

import { z } from "zod";

export const CreateTodoBody = z.object({
  title: z.string().min(1).max(200),
});
export type CreateTodoBody = z.infer<typeof CreateTodoBody>;

export const TodoIdParam = z.string().min(1).max(200);

export const TodoRow = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
});
export type TodoRow = z.infer<typeof TodoRow>;
