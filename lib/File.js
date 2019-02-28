import {
    Component
} from 'react';
import FSCOMPONENTSYMBOL from './FSCOMPONENTSYMBOL.js';
import getFileContentIterator from './getFileContentIterator.js';
const hash = () => "###";
const File = class extends Component {
    constructor(props) {
        super(props);
        this[Symbol.asyncIterator] = async function* () {
            let {
                name,
                hname,
                rename,
                child_of_file = false,
                folder_context = [],
                template_context=''
            } = this.props;
            const contents = [];
            const sidecars = [];
            for await (const {
                content,
                sidecars: sidecars2
            } of getFileContentIterator(this, {
                currentParentName: name,
                currentParentContents: contents,
                template_context
            })) {
                if (content !== null) {
                    contents.push(content);
                }
                if (sidecars2 && sidecars2.length) {
                    sidecars.push(...sidecars2);
                }
            }
            if (typeof name === "function") {
                name = name({
                    currentName: name,
                    contents
                });
            }
            if (!name && hname) {
                if (hname) {
                    if (typeof hname === "string") {
                        const [key, length] = hname.split(":");
                        name = hash(name).substr(0, length || Number.Infinity);
                    } else {
                        name = hash(name);
                    }
                }
            }
            if (child_of_file) {
                yield {
                    content: contents,
                    sidecars
                };
                return;
            }
            if (!name) {
                throw new Error("no file name provided");
            }
            for (const {
                    name,
                    content,
                    sidecar
                } of sidecars) {
                contents.push(sidecar);
                yield {
                    file: name,
                    folder_context,
                    content
                }
            }
            yield {
                file: name,
                folder_context,
                content: contents.flat().join("\n"),
            };
        };
    }
    render() {
        return null;
    }
};
File[FSCOMPONENTSYMBOL] = true;
export default File;
