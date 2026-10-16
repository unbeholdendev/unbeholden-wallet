import { useSyncExternalStore } from "react";

/**
 * Hash routes, so the static build works from any path and offline: `#/send`,
 * `#/tx/<txid>`. Returns the path split into segments, `[]` for none.
 */
export function useRoute(): string[] {
  const hash = useSyncExternalStore(
    (change) => {
      addEventListener("hashchange", change);
      return () => removeEventListener("hashchange", change);
    },
    () => location.hash,
  );
  return hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
}

export function navigate(path: string) {
  location.hash = path;
}
