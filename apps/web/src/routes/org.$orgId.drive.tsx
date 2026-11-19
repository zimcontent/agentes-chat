import { createFileRoute } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { openSearch } from "@/lib/open-param";
import { DrivePage } from "@/pages/DrivePage";

/**
 * Drive: every artifact the viewer can see. `?artifact=…&v=…` opens one (shared links); `?open=…` its details;
 * `?folder=…` the folder open (docs/adr/doug-0036-drive-folders.md).
 */
export const Route = createFileRoute("/org/$orgId/drive")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { artifact?: string; v?: number; open?: string | number; folder?: string } => ({
    ...openSearch(search),
    artifact: typeof search.artifact === "string" ? search.artifact : undefined,
    v: typeof search.v === "number" && search.v > 0 ? search.v : undefined,
    folder: typeof search.folder === "string" && search.folder ? search.folder : undefined,
  }),
  component: function Page() {
    const { artifact, v, folder } = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <Main>
        <DrivePage
          open={artifact ? { id: artifact, version: v } : undefined}
          folderId={folder ?? null}
          onFolder={(id) => void navigate({ search: (s) => ({ ...s, folder: id ?? undefined }) })}
        />
      </Main>
    );
  },
});
