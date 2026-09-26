import { useCallback, useEffect, useRef, useState } from "react";
import { withoutKey } from "../../shared/withoutKey";
import type { GeneratedImage } from "../../shared/images";
import type { View } from "../sidebar/sidebarUtils";

/** Image library, active canvas image, and per-image generate/adjust activity. */
export function useImageLibrary({ setView }: { setView: (view: View) => void }) {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  /** Image ids with generate/adjust in flight — sidebar spinner + keep canvas mounted. */
  const [processingImageIds, setProcessingImageIds] = useState<Record<string, true>>({});
  const activeImageProcessing = Object.keys(processingImageIds).length > 0;

  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; }, [images]);

  const loadImagesList = useCallback(async () => {
    setImages(await window.harness.images.list());
  }, []);

  useEffect(() => {
    void loadImagesList();
  }, [loadImagesList]);

  const openImageInMain = useCallback((imageId: string) => {
    setActiveImageId(imageId);
    setView("images");
    void loadImagesList();
  }, [loadImagesList, setView]);

  const createNewImage = useCallback(() => {
    // Prompt-first: open a blank canvas; the library entry is created on first generate.
    setActiveImageId(null);
    setView("images");
  }, [setView]);

  const deleteImage = useCallback(async (id: string) => {
    const remaining = await window.harness.images.delete(id);
    setImages(remaining);
    setProcessingImageIds((prev) => withoutKey(prev, id));
    if (activeImageId === id) {
      setActiveImageId(null);
    }
  }, [activeImageId]);

  const handleImageRemoved = useCallback((id: string) => {
    setImages((prev) => prev.filter((item) => item.id !== id));
    setProcessingImageIds((prev) => withoutKey(prev, id));
    if (activeImageId === id) {
      setActiveImageId(null);
    }
  }, [activeImageId]);

  const handleImageUpdated = useCallback((image: GeneratedImage) => {
    setImages((prev) =>
      [image, ...prev.filter((item) => item.id !== image.id)].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      ),
    );
    // Create-on-submit (and first generate) selects the new library entry.
    setActiveImageId((prev) => prev ?? image.id);
  }, []);

  const handleImageActivityChange = useCallback((imageId: string, active: boolean) => {
    setProcessingImageIds((prev) => {
      if (active) {
        return prev[imageId] ? prev : { ...prev, [imageId]: true };
      }
      return withoutKey(prev, imageId);
    });
  }, []);

  return {
    images,
    setImages,
    imagesRef,
    activeImageId,
    setActiveImageId,
    processingImageIds,
    activeImageProcessing,
    loadImagesList,
    openImageInMain,
    createNewImage,
    deleteImage,
    handleImageRemoved,
    handleImageUpdated,
    handleImageActivityChange,
  };
}
