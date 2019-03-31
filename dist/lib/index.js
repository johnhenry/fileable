'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var fs = require('fs');
var fs__default = _interopDefault(fs);
require('crypto');
var path = require('path');
var path__default = _interopDefault(path);
var rimraf = _interopDefault(require('rimraf'));
var util = require('util');
var react = require('react');
var JSZip = _interopDefault(require('jszip'));
var child_process = _interopDefault(require('child_process'));
var fetch = _interopDefault(require('node-fetch'));
var ReactDOMServer = _interopDefault(require('react-dom/server'));

var FSCOMPONENTSYMBOL = Symbol.for('FSCOMPONENTSYMBOL');

/**
 * Iterator
 * @kind function
 * @name iterator
 * @param {object} input
 * @example
 * ```javascript
 * import {iterator} from 'fileable';
 * ```
 */
const iterator = async function* (element, {
        folder_context = [],
        template_context =''
        } = {
            folder_context: [],
            template_context:''
    }) {
    if (element.type && element.type[FSCOMPONENTSYMBOL]) {
        yield* new element.type({
            folder_context,
            template_context,
            ...element.props
        });
    } else if (element.type === Symbol.for('react.fragment')) {
        const children = Array.isArray(element.props.children)
            ? element.props.children
            : element.props.children
            ? [element.props.children]
            : [];
        for (const child of children) {
            yield* iterator(child, {
                folder_context,
                template_context
            });
        }
    }
};

// import CacheMap from './cache-map.ts';
const rmdir = util.promisify(rimraf);

const defaultOptions = {
    folder_context: [],
    template_context: ''
};

/**
* Render to File System
* @kind function
* @name renderFS
* @param {object} input
* @example
* ```javascript
* import {renderFS} from 'fileable';
* const main = async () =>
* renderFS(template(), { folder_context: [directory] });
* main();
* ```
*/
var renderFs = async (template,
    {
        folder_context = defaultOptions.folder_context,
        template_context = defaultOptions.template_context,
        cache
    } = defalutOptions) => {
    let hashMap;
    if (cache) {
        hashMap = new CacheMap(cache);
    }

    try {
        for await (const {
            clear,
            folder,
            file,
            content,
            folder_context,
            } of
            iterator(template, {folder_context, template_context})
        ) {
            if (file) {
                const folderPath = path__default.join(...folder_context);
                if (!fs__default.existsSync(folderPath)) {
                    fs__default.mkdirSync(folderPath, {recursive:true});
                }
                fs__default.writeFileSync(path__default.join(...folder_context, file), content);
            }
            if (folder) {
                const folderPath = path__default.join(...folder_context, folder);
                if (!fs__default.existsSync(folderPath)) {
                    fs__default.mkdirSync(folderPath, {recursive:true});
                }
            }
            if (clear) {
                const folderPath = path__default.join(...folder_context, clear);
                if (fs__default.existsSync(folderPath)) {
                    await rmdir(folderPath);
                }
            }
            // hashMap.set(name, newHash);
        }
    } catch (e) {
        console.log(e);
    } finally {
        //hashMap.flush();
    }
};

const defaultOptions$1 = {
    folder_context: [],
    template_context:''
};

/**
* Render to Console
* @kind function
* @name renderConsole
* @param {object} input
* @example
* ```javascript
* import {renderConsole} from 'fileable';
* const main = async () =>
* renderConsole(template(), { folder_context: [directory] });
* main();
* ```
*/
var renderConsole = async (template, {
    folder_context = defaultOptions$1.folder_context,
    template_context = defaultOptions$1.template_context
    } = defaultOptions$1) => {
    for await (const output of iterator(template(), {
        folder_context,
        template_context
    })) {
        console.log(output);
    }
};

//Note: All components exist in same file to prevent circular-dependency errors when building for typescript
const hash = () => '###';

/**
* File component
* @kind function
* @name File
* @description Create Files
* @example
* ```javascript
* // template.jsx
*  import {File} from 'fileable';
*  export () => <File name='readme.md'/>
* ```
*/
const File = class extends react.Component {
    constructor(props) {
        super(props);
        this[Symbol.asyncIterator] = async function* () {
            let {
                name,
                hname,
                rename,
                child_of_file = false,
                folder_context = [],
                template_context = ''
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
            if (typeof name === 'function') {
                name = name({
                    currentName: name,
                    contents
                });
            }
            if (!name && hname) {
                if (hname) {
                    if (typeof hname === 'string') {
                        const [key, length] = hname.split(':');
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
                throw new Error('no file name provided');
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
                };
            }
            yield {
                file: name,
                folder_context,
                content: contents.flat().join('\n'),
            };
        };
    }
    render() {
        return null;
    }
};
File[FSCOMPONENTSYMBOL] = true;

/**
 * Folder component
 * @kind function
 * @name Folder
 * @description Create Folders
 * @example
 *  ```javascript
 *  // template.jsx
 *  import {File, Folder} from 'fileable';
 *  export () => <Folder name='project'><File name='readme.md'/></Folder>
 * ```
 */
const Folder = class extends react.Component {
    constructor(props) {
        super(props);
        this[Symbol.asyncIterator] = async function* () {
            let { props } = this;
            let {
                name,
                rname,
                child_of_file = false,
                folder_context = [],
                template_context = '',
                zip,
                clear
            } = props;

            if (clear) {
                if (clear === true) {
                    clear = '*';
                }
                for (const target of clear.split(':')) {
                    yield {
                        clear: folder_context.concat(target)
                    };
                }
            }


            if (!name && !clear) {
                throw new Error('no folder name provided');
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
                    } of iterator(child, {
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
                        type: 'nodebuffer'
                    })
                };
                return;
            } else {
                yield {
                    folder: name,
                    folder_context,
                };

                for (const child of children) {
                    yield* iterator(child, {
                        folder_context: folder_context.concat(name),
                        template_context
                    });
                }
            }
        };
    }
    render() {
        return null;
    }
};
Folder[FSCOMPONENTSYMBOL] = true;

/**
 * Clear Component
 * @kind function
 * @name Clear
 * @description Remove Files/Folders before creation
 * @example
 *  ```javascript
 *  // template.jsx
 *  import {File, Folder, Clear} from 'fileable';
 *  export () => <Clear><Folder name='project'><File name='readme.md'/></Folder></Clear>
 * ```
 */
const Clear = class extends react.Component {
    constructor(props) {
        super(props);
        this[Symbol.asyncIterator] = async function* () {
            const props = this.props;
            let {
                folder_context = [],
                template_context = '',
                target,
            } = props;
            const targets = (target && target.split(':')) || ['.'];
            for (const target of targets) {
                yield {
                    clear: target,
                    folder_context
                };
            }
            const children = Array.isArray(props.children) ?
                props.children :
                props.children ? [props.children] : [];
            for (const child of children) {
                yield* iterator(child, {
                    folder_context,
                    template_context
                });
            }
        };
    }
    render() {
        return null;
    }
};
Clear[FSCOMPONENTSYMBOL] = true;



const remoteFileMatch = /^(?:(?:https?)|(?:ftp)):\/\//;

const defaultOptions$2 = {
    format: 'utf-8',
    template_context: ''
};

const externalFile = async (uri, {
    format = defaultOptions$2.format,
    template_context = defaultOptions$2.template_context
} = defaultOptions$2) => {
    if (uri.match(remoteFileMatch)) {
        const response = await fetch(uri);
        const text = await response.text();
        return text;
    } else {
        return new Promise((resolve, reject) => {
            fs.readFile(path.join(template_context, uri), (error, text) => {
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
});



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
            contents.push(await externalFile(src, { template_context }));
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
            throw new Error('files cannot contain this type of component Components');
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
                    sidecars.push(...sidecars2);
                    yield {
                        sidecars: sidecars2,
                        content: null
                    };
                }
            }
        }
        else if (typeof child === 'string') {
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
            contents.push(await externalFile(src, { template_context }));
        }
    }
    transformer = transformer || (_ => _);
    if (sidecar) {
        sidecar = typeof sidecar === 'function' ?
            sidecar
            : ({
                contents,
                currentName
            }) => ({
                sidecar: null,
                name: currentName,
                content: contents
            });
        if (typeof sidecar === 'function') {
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
            return;
        } else {
            sidecars.push({
                sidecar: null,
                name,
                content: transformer(contents)
            });
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

exports.Clear = Clear;
exports.File = File;
exports.Folder = Folder;
exports.iterator = iterator;
exports.renderConsole = renderConsole;
exports.renderFS = renderFs;
