# Jebari-ImageBatch

Custom ComfyUI nodes for loading and batching images from multiple sources.

## Nodes

- **Image Batch (Upload)** — drag & drop or browse multiple images directly onto the node. Thumbnail grid, per-image remove, clipboard paste support.
- **Image Batch (Inputs)** — connect up to 10 `IMAGE` inputs.
- **Image Batch (From Folder)** — point to a folder on the ComfyUI server and iterate its images.

## How to use it

1. Load your images (drag & drop, connect them, or point to a folder).
2. Set ComfyUI's **batch count** (top toolbar, next to Run) to the number of images you have.
3. Click **Run** once.

That's it — ComfyUI queues one job per image and runs through them in order automatically. After the last image it loops back to the first one, so nothing ever stops or errors out.

Want to only process some of the images? Use the **selection** field (Upload node), e.g. `1,3,5-7`. Leave it empty to use all of them.

## Installation

```
cd ComfyUI/custom_nodes
git clone https://github.com/ArtefactDesigntn/Jebari-ImageBatch.git
```

Then restart ComfyUI and refresh your browser tab (Ctrl+F5).

## Requirements

Standard ComfyUI Python environment (torch, numpy, Pillow) — no extra dependencies.
