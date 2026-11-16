import { Redirect, useLocalSearchParams } from "expo-router";
import { DesignEditor } from "@/features/review/DesignEditor";
import { isSafeId } from "@/features/shared/logic";

/** A design piece in the editor (`/review/edit/<id>?v=<version>`), from its Revisor (docs/adr/doug-0010-design-review.md). */
export default function DesignEditRoute() {
  const { id, v } = useLocalSearchParams<{ id: string; v?: string }>();
  const version = v ? Number(v) : Number.NaN;
  if (!isSafeId(id) || !Number.isInteger(version) || version < 1) return <Redirect href="/reviews" />;
  return <DesignEditor key={`${id}:${version}`} id={id} version={version} />;
}
