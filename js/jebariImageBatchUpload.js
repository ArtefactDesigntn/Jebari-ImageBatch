import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const GAP = 6;      // gap between thumbnails
const PAD = 10;     // side padding
const MIN_THUMB = 56;
const MAX_THUMB = 140;

function parseLines(v) {
    return (v || "").split("\n").map((l) => l.trim()).filter(Boolean);
}

// Multiline STRING widgets keep their real content in a <textarea> DOM
// element; ComfyUI serializes from that element, not just widget.value.
// Setting only widget.value (as our JS-driven updates were doing) left the
// textarea showing/holding stale text, so Run could queue old filenames
// after Clear All + adding new images. This keeps both in sync.
function setFilesValue(widget, newValue) {
    widget.value = newValue;
    if (widget.element) {
        widget.element.value = newValue;
        // fire input event in case ComfyUI listens for live edits
        widget.element.dispatchEvent(new Event("input", { bubbles: true }));
    }
}

// Responsive grid: pick a thumb size that fills the node width nicely.
function gridMetrics(nodeWidth, count) {
    const avail = Math.max(nodeWidth - PAD * 2, MIN_THUMB);
    // as many columns as fit at MIN_THUMB, capped by image count
    let cols = Math.max(1, Math.floor((avail + GAP) / (MIN_THUMB + GAP)));
    if (count > 0) cols = Math.min(cols, count);
    // stretch thumbs to fill the row
    let thumb = Math.floor((avail - GAP * (cols - 1)) / cols);
    thumb = Math.max(MIN_THUMB, Math.min(MAX_THUMB, thumb));
    return { cols, thumb };
}

app.registerExtension({
    name: "ImageStacker.DropZone",
    nodeCreated(node) {
        if (node.comfyClass !== "ImageStackerDrop") return;

        // darker header bar for visual separation from the body
        node.color = "#1a1a1a";
        node.bgcolor = "#252525";

        if (node.title?.startsWith("Jebari ")) {
            node.title = node.title.replace(/^Jebari\s+/, "");
        }

        // suppress ComfyUI's auto-added big preview image after execution —
        // the thumbnail grid already shows what's loaded, no need to also
        // render a full-size result preview under the node.
        const origOnExecuted = node.onExecuted;
        node.onExecuted = function (message) {
            origOnExecuted?.apply(this, arguments);
            // remove any image-preview widgets ComfyUI just attached
            if (this.widgets) {
                this.widgets = this.widgets.filter((w) => w.name !== "imagepreview" && w.type !== "image_preview");
            }
            // also clear the node's imgs array, which LiteGraph uses to
            // draw a full-size preview under the node body
            this.imgs = null;
            this.setDirtyCanvas(true, true);
        };

        const filesWidget = node.widgets?.find((w) => w.name === "files");
        if (!filesWidget) return;

        // shrink the raw text list (still editable, but small)
        if (filesWidget.element) {
            filesWidget.element.style.fontSize = "10px";
        }
        filesWidget.tooltip =
            "List of uploaded image filenames, one per line. Drop, paste, or " +
            "use Browse to add images. Editable directly if needed.";

        // ---------- browse button (native file picker, multi-select) ----------
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/*";
        fileInput.multiple = true;
        fileInput.style.display = "none";
        fileInput.addEventListener("change", async () => {
            if (fileInput.files?.length) await uploadFiles(fileInput.files);
            fileInput.value = ""; // allow re-selecting the same file later
        });
        document.body.appendChild(fileInput);

        const browseBtn = node.addWidget("button", "📂 Browse Files...", null, () => {
            fileInput.click();
        });
        browseBtn.serialize = false;
        browseBtn.tooltip = "Pick one or more image files from your computer to add to the stack.";

        node.onRemoved = (function (orig) {
            return function () {
                fileInput.remove();
                orig?.apply(this, arguments);
            };
        })(node.onRemoved);

        // ---------- clear all button ----------
        const clearBtn = node.addWidget("button", "🗑️ Clear All", null, () => {
            if (!parseLines(filesWidget.value).length) return;
            node._thumbs = {};
            setFilesValue(filesWidget, "");
            filesWidget.callback?.(filesWidget.value);
            const selectionWidget = node.widgets?.find((w) => w.name === "selection");
            if (selectionWidget) {
                selectionWidget.value = "";
                if (selectionWidget.element) {
                    selectionWidget.element.value = "";
                    selectionWidget.element.dispatchEvent(new Event("input", { bubbles: true }));
                }
                selectionWidget.callback?.(selectionWidget.value);
            }
            refreshSize();
        });
        clearBtn.serialize = false;
        clearBtn.tooltip = "Remove every dropped/pasted/browsed image from this node.";

        // ---------- reserved grid area BELOW all widgets ----------
        // We add an invisible spacer widget at the end whose computeSize
        // reserves exactly the space the grid needs, so nothing overlaps.
        function gridRows() {
            const names = parseLines(filesWidget.value);
            if (!names.length) return { rows: 0, thumb: 0 };
            const { cols, thumb } = gridMetrics(node.size[0], names.length);
            return { rows: Math.ceil(names.length / cols), thumb };
        }

        const spacer = node.addWidget("info", "", "", () => {}, {});
        spacer.name = "_thumb_spacer";
        spacer.draw = () => {};            // draw nothing
        spacer.computeSize = (width) => {
            const g = gridRows();
            return [width, g.rows ? g.rows * (g.thumb + GAP) + GAP + 4 : 0];
        };
        spacer.serialize = false;

        // ---------- thumbnail cache ----------
        node._thumbs = {};
        function ensureThumb(name) {
            if (node._thumbs[name]) return node._thumbs[name];
            const img = new Image();
            const parts = name.split("/");
            const file = parts.pop();
            const subfolder = parts.join("/");
            img.src = api.apiURL(
                `/view?filename=${encodeURIComponent(file)}` +
                `&type=input&subfolder=${encodeURIComponent(subfolder)}` +
                `&rand=${Math.random()}`
            );
            img.onload = () => node.setDirtyCanvas(true, true);
            node._thumbs[name] = img;
            return img;
        }

        // grid geometry (y position = after the last real widget = spacer zone)
        function gridTop() {
            // spacer widget's last_y is set by LiteGraph when drawing widgets
            if (spacer.last_y != null) return spacer.last_y + 4;
            const g = gridRows();
            return node.size[1] - (g.rows * (g.thumb + GAP) + GAP);
        }

        // ---------- draw thumbnails inside the spacer zone ----------
        const origDraw = node.onDrawForeground;
        node.onDrawForeground = function (ctx) {
            origDraw?.apply(this, arguments);
            if (this.flags?.collapsed) return;

            const names = parseLines(filesWidget.value);
            if (!names.length) return;

            const { cols, thumb } = gridMetrics(this.size[0], names.length);
            const top = gridTop();

            names.forEach((name, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const x = PAD + col * (thumb + GAP);
                const y = top + row * (thumb + GAP);

                ctx.fillStyle = "#222";
                ctx.fillRect(x, y, thumb, thumb);

                const img = ensureThumb(name);
                if (img.complete && img.naturalWidth > 0) {
                    const s = Math.min(thumb / img.naturalWidth, thumb / img.naturalHeight);
                    const w = img.naturalWidth * s;
                    const h = img.naturalHeight * s;
                    ctx.drawImage(img, x + (thumb - w) / 2, y + (thumb - h) / 2, w, h);
                }

                ctx.strokeStyle = "#555";
                ctx.strokeRect(x + 0.5, y + 0.5, thumb - 1, thumb - 1);

                // big clear number badge (bottom-left)
                ctx.fillStyle = "rgba(0,0,0,0.75)";
                ctx.fillRect(x, y + thumb - 18, 22, 18);
                ctx.fillStyle = "#ffd75e";
                ctx.font = "bold 13px Arial";
                ctx.fillText(String(i + 1), x + 5, y + thumb - 5);

                // ✕ remove button (top-right)
                ctx.fillStyle = "rgba(0,0,0,0.75)";
                ctx.fillRect(x + thumb - 16, y, 16, 16);
                ctx.fillStyle = "#f66";
                ctx.font = "11px Arial";
                ctx.fillText("\u2715", x + thumb - 12, y + 12);
            });
        };

        function refreshSize() {
            const keepWidth = node.size[0];
            const computed = node.computeSize();
            node.setSize([Math.max(keepWidth, computed[0]), computed[1]]);
            node.setDirtyCanvas(true, true);
        }

        // click ✕ removes image from list — global capture listener so it
        // works on every frontend regardless of widget hit-testing.
        function hitTestRemove(localX, localY) {
            const names = parseLines(filesWidget.value);
            if (!names.length) return false;
            const { cols, thumb } = gridMetrics(node.size[0], names.length);
            const top = gridTop();
            for (let i = 0; i < names.length; i++) {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const x = PAD + col * (thumb + GAP);
                const y = top + row * (thumb + GAP);
                if (localX >= x + thumb - 18 && localX <= x + thumb + 2 &&
                    localY >= y - 2 && localY <= y + 18) {
                    names.splice(i, 1);
                    setFilesValue(filesWidget, names.join("\n"));
                    filesWidget.callback?.(filesWidget.value);
                    refreshSize();
                    return true;
                }
            }
            return false;
        }

        function clickHandler(e) {
            if (node.graph == null) {
                document.removeEventListener("pointerdown", clickHandler, true);
                return;
            }
            const canvasEl = app.canvas?.canvas;
            if (!canvasEl || e.target !== canvasEl) return;
            const rect = canvasEl.getBoundingClientRect();
            const ds = app.canvas.ds;
            const gx = (e.clientX - rect.left) / ds.scale - ds.offset[0];
            const gy = (e.clientY - rect.top) / ds.scale - ds.offset[1];
            const localX = gx - node.pos[0];
            const localY = gy - node.pos[1];
            if (localX < 0 || localX > node.size[0] ||
                localY < 0 || localY > node.size[1]) return;
            if (hitTestRemove(localX, localY)) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }
        document.addEventListener("pointerdown", clickHandler, true);

        // legacy path too (older frontends)
        const origMouse = node.onMouseDown;
        node.onMouseDown = function (e, pos) {
            if (hitTestRemove(pos[0], pos[1])) return true;
            return origMouse?.apply(this, arguments);
        };

        // ---------- upload ----------
        async function uploadFiles(fileList) {
            const files = [...fileList].filter((f) => f.type?.startsWith("image/"));
            if (!files.length) return false;
            let added = 0;
            for (const file of files) {
                try {
                    const body = new FormData();
                    body.append("image", file);
                    const resp = await api.fetchApi("/upload/image", { method: "POST", body });
                    if (resp.status === 200) {
                        const data = await resp.json();
                        const name = data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
                        const lines = parseLines(filesWidget.value);
                        if (!lines.includes(name)) {
                            lines.push(name);
                            setFilesValue(filesWidget, lines.join("\n"));
                            added++;
                        }
                    }
                } catch (err) {
                    console.error("[ImageStackerDrop] upload failed:", err);
                }
            }
            if (added > 0) {
                filesWidget.callback?.(filesWidget.value);
                refreshSize();
            }
            return added > 0;
        }

        // legacy hooks
        node.onDragOver = function (e) {
            return !!(e?.dataTransfer?.items &&
                [...e.dataTransfer.items].some((i) => i.kind === "file"));
        };
        node.onDragDrop = async function (e) {
            return await uploadFiles(e?.dataTransfer?.files || []);
        };

        // robust global capture drop (new frontends)
        function dropHandler(e) {
            if (!e.dataTransfer?.files?.length) return;
            if (node.graph == null) {
                document.removeEventListener("drop", dropHandler, true);
                return;
            }
            const canvasEl = app.canvas?.canvas;
            if (!canvasEl) return;
            const rect = canvasEl.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right ||
                e.clientY < rect.top || e.clientY > rect.bottom) return;
            const ds = app.canvas.ds;
            const gx = (e.clientX - rect.left) / ds.scale - ds.offset[0];
            const gy = (e.clientY - rect.top) / ds.scale - ds.offset[1];
            const [nx, ny] = node.pos;
            const [nw, nh] = node.size;
            const TITLE = 30;
            if (gx >= nx && gx <= nx + nw && gy >= ny - TITLE && gy <= ny + nh) {
                e.preventDefault();
                e.stopImmediatePropagation();
                uploadFiles(e.dataTransfer.files);
            }
        }
        document.addEventListener("drop", dropHandler, true);
        node.onRemoved = (function (orig) {
            return function () {
                document.removeEventListener("drop", dropHandler, true);
                document.removeEventListener("pointerdown", clickHandler, true);
                orig?.apply(this, arguments);
            };
        })(node.onRemoved);

        // ---------- clipboard paste (Ctrl+V) when this node is selected OR hovered ----------
        function isNodeHovered() {
            const mouse = app.canvas?.graph_mouse;
            if (!mouse) return false;
            const [nx, ny] = node.pos;
            const [nw, nh] = node.size;
            const TITLE = 30;
            return mouse[0] >= nx && mouse[0] <= nx + nw &&
                   mouse[1] >= ny - TITLE && mouse[1] <= ny + nh;
        }

        async function pasteHandler(e) {
            if (node.graph == null) {
                document.removeEventListener("paste", pasteHandler, true);
                return;
            }
            // only when focus is not in a text field
            const ae = document.activeElement;
            if (ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT" ||
                       ae.isContentEditable)) return;
            const selected = app.canvas?.selected_nodes;
            const isSelected = selected && selected[node.id];
            if (!isSelected && !isNodeHovered()) return;

            const items = [...(e.clipboardData?.items || [])]
                .filter((it) => it.type?.startsWith("image/"));
            if (!items.length) return;

            e.preventDefault();
            e.stopImmediatePropagation();

            const files = [];
            for (const it of items) {
                const blob = it.getAsFile();
                if (!blob) continue;
                const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
                const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
                files.push(new File([blob], `clipboard_${stamp}_${files.length}.${ext}`,
                                    { type: blob.type }));
            }
            if (files.length) await uploadFiles(files);
        }
        document.addEventListener("paste", pasteHandler, true);
        node.onRemoved = (function (orig) {
            return function () {
                document.removeEventListener("paste", pasteHandler, true);
                orig?.apply(this, arguments);
            };
        })(node.onRemoved);

        setTimeout(refreshSize, 100);

        // ---------- tooltips for the remaining fields ----------
        const selectionWidget = node.widgets?.find((w) => w.name === "selection");
        if (selectionWidget) {
            selectionWidget.tooltip =
                "Choose which images (by number shown on each thumbnail) to use, " +
                "in order.\ne.g. '1,3,5-7'. Leave empty to use all images.\n" +
                "Set ComfyUI's batch count (top toolbar) to the number of " +
                "selected images to run the workflow once per image.";
        }
    },
});
