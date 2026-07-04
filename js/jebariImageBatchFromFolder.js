import { app } from "../../scripts/app.js";

// Same dark styling as ImageStackerDrop, applied to ImageStackerFromFolder.
app.registerExtension({
    name: "ImageStackerFromFolder.Style",
    nodeCreated(node) {
        if (node.comfyClass !== "ImageStackerFromFolder") return;

        node.color = "#1a1a1a";
        node.bgcolor = "#252525";

        if (node.title?.startsWith("Jebari ")) {
            node.title = node.title.replace(/^Jebari\s+/, "");
        }

        const folderWidget = node.widgets?.find((w) => w.name === "folder_path");
        if (folderWidget) {
            folderWidget.tooltip =
                "Full path to a folder on the ComfyUI server containing images.\n" +
                "e.g. G:\\images\\batch";
        }

        const sortWidget = node.widgets?.find((w) => w.name === "sort");
        if (sortWidget) {
            sortWidget.tooltip = "Order in which files are listed: by filename or by modified date.";
        }
    },
});
