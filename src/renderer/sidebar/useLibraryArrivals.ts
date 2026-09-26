import { useCallback, useState } from "react";
import {
  arrivedLibraryIds as collectArrivedLibraryIds,
  consumeArrivalId,
  mergeArrivalTimes,
  pruneArrivalTimes,
  type LibraryArrivalFingerprint,
} from "../../shared/libraryArrival";

/** Ids pulled/merged from R2 in this session — faded "arrived" mark in the library. */
export function useLibraryArrivals() {
  const [arrivedLibraryIds, setArrivedLibraryIds] = useState<Record<string, number>>({});

  const consumeArrival = useCallback((id: string) => {
    setArrivedLibraryIds((prev) => consumeArrivalId(prev, id));
  }, []);

  const recordArrivals = useCallback((before: LibraryArrivalFingerprint[], after: LibraryArrivalFingerprint[]) => {
    const arrived = collectArrivedLibraryIds(before, after);
    setArrivedLibraryIds((prev) =>
      arrived.length === 0 ? pruneArrivalTimes(prev) : mergeArrivalTimes(prev, arrived),
    );
  }, []);

  return { arrivedLibraryIds, consumeArrival, recordArrivals };
}
