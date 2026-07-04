import os
import hashlib

import torch
import numpy as np
from PIL import Image

MAX_IMAGES = 10


def _wipe_queue():
    try:
        from server import PromptServer
        PromptServer.instance.prompt_queue.wipe_queue()
    except Exception:
        pass


def _ihash(img_tensor):
    """Content hash of an IMAGE tensor (first frame if batched)."""
    try:
        t = img_tensor
        if t.dim() == 4:
            t = t[0]
        arr = (t.detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
        return hashlib.sha1(arr.tobytes()).hexdigest()
    except Exception:
        return None


class ImageStacker:
    """
    Connect up to 10 images. Each Run outputs the NEXT image in order,
    advancing a counter automatically — set ComfyUI's batch count (top
    toolbar) to the number of images and click Run once to queue one job
    per image. Loops back to the first image after the last one (no error).
    """

    _counters = {}

    @classmethod
    def INPUT_TYPES(cls):
        inputs = {
            "required": {},
            "optional": {},
            "hidden": {"unique_id": "UNIQUE_ID"},
        }
        for i in range(1, MAX_IMAGES + 1):
            inputs["optional"][f"image_{i}"] = ("IMAGE",)
        return inputs

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("image", "index", "total")
    FUNCTION = "stack"
    CATEGORY = "utils/image"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")  # re-run on every queue execution

    def stack(self, unique_id=None, **kwargs):
        images = []
        for i in range(1, MAX_IMAGES + 1):
            img = kwargs.get(f"image_{i}")
            if img is not None:
                images.append(img)
        if not images:
            raise ValueError("Connect at least one image.")

        total = len(images)
        key = f"ImageStacker:{unique_id or 'default'}"
        pos = ImageStacker._counters.get(key, 0) % total
        ImageStacker._counters[key] = pos + 1

        print(f"[ImageStacker] run -> image {pos + 1}/{total}")
        return (images[pos], pos + 1, total)


class ImageStackerFromFolder:
    """
    Iterate images from a folder. Each Run outputs the NEXT image in order,
    advancing a counter automatically — set ComfyUI's batch count (top
    toolbar) to the number of images and click Run once to queue one job
    per image. Loops back to the first image after the last one (no error).
    """

    EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
    _counters = {}

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder_path": ("STRING", {"default": "", "placeholder": "G:\\images\\batch"}),
                "sort": (["name", "date"], {"default": "name"}),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("IMAGE", "STRING", "INT", "INT")
    RETURN_NAMES = ("image", "filename", "index", "total")
    FUNCTION = "run"
    CATEGORY = "utils/image"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    def _load(self, path):
        img = Image.open(path).convert("RGB")
        arr = np.array(img).astype(np.float32) / 255.0
        return torch.from_numpy(arr)[None,]

    def run(self, folder_path, sort, unique_id=None):
        folder_path = folder_path.strip().strip('"')
        if not os.path.isdir(folder_path):
            raise FileNotFoundError(f"Folder not found: {folder_path}")

        files = [f for f in os.listdir(folder_path)
                 if f.lower().endswith(self.EXTS)]
        if sort == "date":
            files.sort(key=lambda f: os.path.getmtime(os.path.join(folder_path, f)))
        else:
            files.sort()
        if not files:
            raise ValueError("No images in folder.")

        total = len(files)
        key = f"ImageStackerFromFolder:{unique_id or 'default'}:{folder_path}"
        pos = ImageStackerFromFolder._counters.get(key, 0) % total
        ImageStackerFromFolder._counters[key] = pos + 1

        f = files[pos]
        img = self._load(os.path.join(folder_path, f))
        print(f"[ImageStackerFromFolder] run -> {f} ({pos + 1}/{total})")
        return (img, f, pos + 1, total)


NODE_CLASS_MAPPINGS = {
    "ImageStacker": ImageStacker,
    "ImageStackerFromFolder": ImageStackerFromFolder,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageStacker": "Jebari Image Batch (Inputs)",
    "ImageStackerFromFolder": "Jebari Image Batch (From Folder)",
}


class ImageStackerDrop:
    """
    Drag & drop MULTIPLE images from disk directly onto the node (one drag,
    whole selection). Files are uploaded to ComfyUI's input folder and listed
    in the 'files' box (one per line, editable).
    Each Run outputs the NEXT image in order, advancing a counter
    automatically — set ComfyUI's batch count (top toolbar) to the number of
    images and click Run once to queue one job per image. Loops back to the
    first image after the last one (no error). Use the 'selection' field to
    restrict which images are used (e.g. '1,3,5-7'); leave empty for all.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "files": ("STRING", {
                    "multiline": True, "default": "",
                    "placeholder": "Drop images anywhere on this node.\nOne filename per line (editable).",
                }),
                "selection": ("STRING", {
                    "default": "",
                    "placeholder": "e.g. 1,3,5-7  (empty = all)",
                }),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("IMAGE", "STRING", "INT", "INT")
    RETURN_NAMES = ("image", "filename", "index", "total")
    FUNCTION = "run"
    CATEGORY = "utils/image"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    @staticmethod
    def _parse_selection(selection, total):
        """'1,3,5-7' -> [0,2,4,5,6]. Empty -> all. Ignores out-of-range."""
        sel = (selection or "").strip()
        if not sel:
            return list(range(total))
        out = []
        for part in sel.replace(" ", "").split(","):
            if not part:
                continue
            if "-" in part:
                a, _, b = part.partition("-")
                try:
                    a, b = int(a), int(b)
                except ValueError:
                    continue
                for n in range(min(a, b), max(a, b) + 1):
                    if 1 <= n <= total and (n - 1) not in out:
                        out.append(n - 1)
            else:
                try:
                    n = int(part)
                except ValueError:
                    continue
                if 1 <= n <= total and (n - 1) not in out:
                    out.append(n - 1)
        return out

    def _resolve(self, name):
        import folder_paths
        base = folder_paths.get_input_directory()
        path = os.path.join(base, name)
        if not os.path.isfile(path):
            raise FileNotFoundError(f"Not found in input folder: {name}")
        return path

    def _load(self, path):
        img = Image.open(path).convert("RGB")
        arr = np.array(img).astype(np.float32) / 255.0
        return torch.from_numpy(arr)[None,]

    # persistent per-node counter: advances by 1 on every run, wraps back
    # to the start automatically — no error, no history to reset
    _counters = {}

    def run(self, files, selection, unique_id=None):
        names = [l.strip() for l in files.splitlines() if l.strip()]
        if not names:
            raise ValueError("Drop images onto the node first (list is empty).")

        picked = self._parse_selection(selection, len(names))
        if not picked:
            raise ValueError(f"Selection '{selection}' matches no image "
                             f"(list has {len(names)} images).")
        names = [names[i] for i in picked]
        numbers = [i + 1 for i in picked]   # original thumbnail numbers
        total = len(names)

        key = f"ImageStackerDrop:{unique_id or 'default'}"
        pos = ImageStackerDrop._counters.get(key, 0) % total
        ImageStackerDrop._counters[key] = pos + 1

        n = names[pos]
        full = self._resolve(n)
        print(f"[ImageStackerDrop] run -> image #{numbers[pos]} "
              f"({pos + 1}/{total} of selection): {n}")
        return (self._load(full), n, numbers[pos], total)


NODE_CLASS_MAPPINGS["ImageStackerDrop"] = ImageStackerDrop
NODE_DISPLAY_NAME_MAPPINGS["ImageStackerDrop"] = "Jebari Image Batch (Upload)"

WEB_DIRECTORY = "./js"
