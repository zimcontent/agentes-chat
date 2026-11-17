import { Redirect, useLocalSearchParams } from "expo-router";
import { textParam, vaultHref } from "@/features/vault/logic";
import { VaultSheet } from "@/features/vault/VaultSheet";
import { SheetSurface } from "@/ui/SheetSurface";

/** A Vault item over Senhas (`?id=`, ADR 0144): its fields to copy, who may use it, its last use. */
export default function SettingsVaultSheetRoute() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = textParam(params.id);
  if (!id) return <Redirect href={vaultHref.list as never} />;
  return (
    <SheetSurface>
      <VaultSheet key={id} id={id} />
    </SheetSurface>
  );
}
