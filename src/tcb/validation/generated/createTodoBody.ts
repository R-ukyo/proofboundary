// GENERATED from src/verified/specs/todo.ts (createTodoRequires) — do not edit by hand.
// Regenerate: node tools/codegen/validators.mjs (freshness enforced by `npm run verify`).
import { z } from "zod";

export const CreateTodoBody = z.object({
    title: z.string().min(1).max(200),
});
export type CreateTodoBody = z.infer<typeof CreateTodoBody>;
