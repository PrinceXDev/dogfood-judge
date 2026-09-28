import { redirect } from "next/navigation";

// "Judging" is the name used in the command palette and docs; the route is /judge.
export default function JudgingAlias() {
  redirect("/judge");
}
