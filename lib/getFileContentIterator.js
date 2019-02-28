import child_process from 'child_process';

import ReactDOMServer from "react-dom/server";

import File from './File.js';
import Folder from './Folder.js';
import Clear from './Clear.js';
import { readFile } from "fs";
import { join } from 'path';
const remoteFileMatch = /^(?:(?:https?)|(?:ftp)):\/\//;

const defaultOptions = {
    format: 'utf-8',
    template_context: ''
};

const externalFile = async (uri, {
    format = defaultOptions.format,
    template_context = defaultOptions.template_context
} = defaultOptions ) => {
    if (uri.match(remoteFileMatch)) {
        const response = await fetch(uri);
        const text = await response.text();
        return text;
    } else {
        return new Promise((resolve, reject) => {
            readFile(join(template_context, uri), (error, text) => {
                if (error) {
                    return reject(error);
                }
                return resolve(text);
            });
        });
    }
};
const runCommand = async (command) => new Promise((resolve, reject) => {
    child_process.exec(command, (error, output) => {
        if (error) {
            return reject(error);
        }
        return resolve(output);
    });
})



const getFileContentIterator = async function* (
    element, {
        currentParentName,
        currentParentContents,
        child_of_file,
        template_context
    }
) {
    const {
        props
    } = element;
    let {
        src,
        cmd,
        silent,
        prepend,
        async,
        transformer,
        sidecar,
        name,
    } = props;

    const contents = [];
    const sidecars = [];

    if (!prepend) {
        if (cmd) {
            const content = await runCommand(cmd);
            if (!silent) {
                contents.push(content);
            }
        } else if (src) {
            contents.push(await externalFile(src, {template_context}));
        }
    }
    //
    const children = Array.isArray(props.children)
        ? props.children
        : props.children
        ? [props.children]
        : [];
    for (const child of children) {
        if (child.type === Folder || child.type === Clear) {
            throw new Error("files cannot contain this type of component Components");
        } else if (child.type === File) {
            for await (const {
                content,
                sidecars: sidecars2
            } of new child.type({
                ...child.props,
                child_of_file: true,
                template_context
            })) {
                if (content !== null) {
                    contents.push(content.flat().join(''));
                }
                if (sidecars && sidecars2.length) {
                    sidecars.push(...sidecars2)
                    yield {
                        sidecars: sidecars2,
                        content: null
                    };
                }
            }
        }
        else if (typeof child === "string") {
            contents.push(child);
        }
        else {
            // Render React element
            contents.push(ReactDOMServer.renderToStaticMarkup(child));
        }
    }
    ///
    if (prepend) {
        if (cmd) {
            const content = await runCommand(cmd);
            if (!silent) {
                contents.push(content);
            }
        } else if (src) {
            contents.push(await externalFile(src, {template_context}));
        }
    }
    transformer = transformer || (_ => _);
    if (sidecar) {
        sidecar = typeof sidecar === "function" ?
            sidecar
            : ({
                contents,
                currentName
            }) => ({
                sidecar: null,
                name: currentName,
                content: contents
            });
        if (typeof sidecar === "function") {
            const sidecarCandidate = sidecar({
                currentParentContents,
                contents,
                currentName: name
            });
            if (sidecarCandidate.name) {
                sidecars.push({
                    sidecar: sidecarCandidate.sidecar,
                    name: sidecarCandidate.name,
                    content: sidecarCandidate.content
                });
            }
            yield {
                sidecars,
                content: transformer(sidecar.content)
            };
            return
        } else {
            sidecars.push({
                sidecar:null,
                name,
                content: transformer(contents)
            })
            yield {
                sidecars
            };
            return;
        }
    }
    yield {
        content: contents.length ? contents : null
    };
};
export default getFileContentIterator;
