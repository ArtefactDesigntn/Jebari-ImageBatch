import { app } from "../../scripts/app.js";

// Same dark styling as ImageStackerDrop, applied to the plain ImageStacker node.
app.registerExtension({
    name: "ImageStacker.Style",
    nodeCreated(node) {
        if (node.comfyClass !== "ImageStacker") return;

        node.color = "#1a1a1a";
        node.bgcolor = "#252525";

        // header stays clean; "Jebari" remains searchable via the node list
        // and still shows on the pack badge next to the node id.
        if (node.title?.startsWith("Jebari ")) {
            node.title = node.title.replace(/^Jebari\s+/, "");
        }
    },
});
