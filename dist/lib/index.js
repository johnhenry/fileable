'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var fileableComponents = require('fileable-components');
var fs = _interopDefault(require('fs'));
require('crypto');
var path = _interopDefault(require('path'));
var rimraf = _interopDefault(require('rimraf'));
var util = require('util');

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
    if (element.type && element.type[fileableComponents.FSCOMPONENTSYMBOL]) {
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
                const folderPath = path.join(...folder_context);
                if (!fs.existsSync(folderPath)) {
                    fs.mkdirSync(folderPath, {recursive:true});
                }
                fs.writeFileSync(path.join(...folder_context, file), content);
            }
            if (folder) {
                const folderPath = path.join(...folder_context, folder);
                if (!fs.existsSync(folderPath)) {
                    fs.mkdirSync(folderPath, {recursive:true});
                }
            }
            if (clear) {
                const folderPath = path.join(...folder_context, clear);
                if (fs.existsSync(folderPath)) {
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
    for await (const output of iterator(template, {
        folder_context,
        template_context
    })) {
        console.log(output);
    }
};

exports.iterator = iterator;
exports.renderConsole = renderConsole;
exports.renderFS = renderFs;
