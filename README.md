# Jebari-ImageBatch

Custom ComfyUI nodes for loading and batching images from multiple sources.

## Nodes

- **Image Batch (Upload)** — drag & drop or browse multiple images directly onto the node. Thumbnail grid, per-image remove, clipboard paste support.
- **Image Batch (Inputs)** — connect up to 10 `IMAGE` inputs.
- **Image Batch (From Folder)** — point to a folder on the ComfyUI server and iterate its images.

All three advance automatically: each **Run** outputs the next image in order. Set ComfyUI's batch count (top toolbar) to the number of images you want and click Run once — ComfyUI queues one job per image. The counter loops back to the first image after the last one (no errors, nothing to reset).

Use the **selection** field (Upload node) to restrict which images are used, e.g. `1,3,5-7`. Leave empty to use all.

## Installation

1. Download or clone this repo into your ComfyUI `custom_nodes` folder:
   ```
   cd ComfyUI/custom_nodes
   git clone https://github.com/YOUR_USERNAME/Jebari-ImageBatch.git
   ```
2. Restart ComfyUI.
3. Hard-refresh the browser tab (Ctrl+F5).

## Requirements

Standard ComfyUI Python environment (torch, numpy, Pillow) — no extra dependencies.
