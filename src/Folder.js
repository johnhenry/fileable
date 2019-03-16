import {
    Component
} from 'react';
import FSCOMPONENTSYMBOL from './FSCOMPONENTSYMBOL.js';
import render from "./iterator.js";
import File from "./File.js";
import JSZip from "jszip";

const Folder = class extends Component {
    constructor(props) {
        super(props);
        this[Symbol.asyncIterator] = async function* () {
            let {props} = this;
            let {
                name,
                rname,
                child_of_file = false,
                folder_context = [],
                template_context='',
                zip,
                clear
            } = props;

            if (clear) {
                if (clear === true) {
                    clear = "*"
                }
                for (const target of clear.split(':')) {
                    yield {
                        clear: folder_context.concat(target)
                    }
                }
            }


            if (!name && !clear) {
                throw new Error("no folder name provided");
            }
            const children = Array.isArray(props.children) ?
                props.children :
                props.children ? [props.children] : [];
            if (zip) {
                const archiveFile = new JSZip();
                for (const child of children) {
                    for await (const {
                        folder,
                        file,
                        content,
                        folder_context
                    } of render(child, {
                    folder_context: folder_context.concat(name),
                    template_context
                    })) {
                        //TODO : determine folder location bassed on folder_context

                        if (folder) {
                            archiveFile.folder(folder);
                        } else if (file) {
                            archiveFile.file(file, content);
                        }
                    }
                }
                yield {
                    file: name,
                    folder_context,
                    content: await archiveFile.generateAsync({
                        type: "nodebuffer"
                    })
                }
                return;
            } else {
                yield {
                    folder: name,
                    folder_context,
                }

                for (const child of children) {
                    yield* render(child, {
                        folder_context: folder_context.concat(name),
                        template_context
                    })
                }
            }
        }
    }
    render() {
        return null;
    }
};
Folder[FSCOMPONENTSYMBOL] = true;
export default Folder;
