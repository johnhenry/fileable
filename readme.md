![fileable logo](./static/docs/logo.png)

# Fileable

Render a file tree using a JSX template.

Inspired by [React FS Renderer](https://github.com/ericvicenti/react-fs-renderer).

## Related Projects

### CLI
- [CLI](https://github.com/johnhenry/fileable-cli)

### Components
- [File](https://github.com/johnhenry/fileable-component-file) - create files
- [Folder](https://github.com/johnhenry/fileable-component-folder) - create folders and archives
- [Clear](https://github.com/johnhenry/fileable-component-clear) - remove files and folders

## Installation

```sh
npm install fileable
```

## Usage

## Bacis Usage

```javascript
import { renderConsole, renderFS } from 'fileable';
import template from './path/to/sample-template.jsx';
const options = {
 template_context:'./path/to/',
 folder_context: './destination'
};
renderConsole(template, options);
renderFS(template, options);
```

### Templates Files

Templates are jsx files. The default export will be used to generate a file tree.
(Note: You must always include a reference to 'React');

```javascript
import React, {Fragment} from 'react';
export default ()=><></>;
```

#### Components

By default, [React.Fragments](https://reactjs.org/docs/fragments.html) are available and other components may be imported if installed locally.

```sh
npm install fileable-component-file fileable-component-folder fileable-component-clear
```

```javascript
import React, {Fragment} from 'react';
import File from 'fileable-component-file';
import Folder from 'fileable-component-folder';
import Clear from 'fileable-component-clear';
export default ()=><>
    <Clear>
    <File name='readme.md'>
    # I am a readme
    </File>
    <Folder name='src'>
        <File name='index.html' doctype='html'>
        <html>
            <head></head>
            <scrpit src='index.js'></script>
            <body>
                See Console for result.
            </body>
        </html>
        </File>
        <File name='index.js'>
        console.log('hello world');
        </File>
    </Folder>
    </Clear>
</>
```

Components cand be composed and extended.

```javascript
import React from 'react';
import File from 'fileable-component-file';
import Folder from 'fileable-component-folder';
import Clear from 'fileable-component-clear';
const DateFile = () =><File name='today.date' cmd='date' />
export default ()=><>
    <Clear>
    <File name='readme.md'>
    # I am a readme
    </File>
    <DateFile />
    </Clear>
</>
```


#### Inputs

If the template would accept inputs, you may pass them into the template as a function arguments;

```javascript
export default (first, second, third)=><>...
```

```javascript
import {renderFS} from 'fileable';
import template from './path/to/sample-template.jsx';
const template_context = './path/to/';
const folder_context = './destination';
renderFS(template('first', 'second', 'third'), { folder_context, template_context});
```

## Creating a Fileable Component

Creating fileable components is easy. Components must meet the following criteria.

1. Must be an asynchronous iterator yielding objects conforming to the "Fileable Component Protocol" (see below)

2. Must have key 'FILEABLE COMPONENT' set to a truthy value.

### Fileable Component Protocol

Fileable components must yield objects containing a 'directive' key -- along with other keys -- that and tells the renderer how to render the desired file tree.

### directive: FILE

The FILE directive is used to create files.

See the above File component for an example.

#### key: name

Name of file to create.

#### key: content

Content of file to create.

#### key: mode

Mode of file to create.

#### key: append

If set to true, content will be added to a file. Othewise, content will be ovewrwriten.

#### key: folder_context

Context in which to create file.

### Directive: FOLDER

The FOLDER directive is used to create folders.

See the above Folder component for an example.

#### key: name

Name of folder to create.

#### key: folder_context

Context in which to create folder.

### Directive: CLEAR

The CLEAR directive is used to delete files and folders.

See the above Clear component for an example.

#### key: target

String representing files or folders to delete.
May be a [glob](https://github.com/isaacs/node-glob) pattern.
May use '!' to negate files.


### Directive: WARNING

The WARNING directive is used to denote that something went wrong but the process will continue.

#### key: message

Message explaining what went wrong.


### Directive: ERROR

The ERROR directive is used to denote that something went wrong but the process will continue.


#### key: message

Message explaining what went wrong.


#### key: folder_context

Context in which to delete targets.

## Creating a Fileable Component

Creating fileable components is easy. Components must meet the following criteria.

1. Must be an asynchronous iterator yielding objects conforming to the "Fileable Component Protocol" (see below)

2. Must have key 'FILEABLE COMPONENT' set to true.

### Fileable Component Protocol

Fileable components must yield objects containing a 'directive' key -- along with other keys -- that and tells the renderer how to render the desired file tree.

### directive: FILE

The FILE is used to create files.

See the above File component for an example.

#### key: name

Name of file to create.

#### key: content

Content of file to create.

#### key: mode

Mode of file to create.

#### key: append

If set to true, content will be added to a file. Othewise, content will be ovewrwriten.

#### key: folder_context

Context in which to create file.

### Directive: FOLDER

The FOLDER is used to create folders.

See the above Folder component for an example.

#### key: name

Name of folder to create.

#### key: folder_context

Context in which to create folder.

### Directive: CLEAR

The CLEAR is used to delete files and folders.

See the above Clear component for an example.

#### key: target

String representing files or folders to delete.
May be a [glob](https://github.com/isaacs/node-glob) pattern.
May use '!' to negate files.

#### key: folder_context

Context in which to delete targets.
## API

### Table of contents

- [function renderConsole](#function-renderconsole)
  - [Examples](#examples)
- [function renderFS](#function-renderfs)
  - [Examples](#examples-1)

### function renderConsole

Render file tree to console

| Parameter                  | Type     | Description                                                        |
| :------------------------- | :------- | :----------------------------------------------------------------- |
| `input`                    | function |                                                                    |
| `options`                  | object   |                                                                    |
| `options.folder_context`   | string   | Folder into which files should be renddered                        |
| `options.template_context` | string   | Location of template. Used to determine relateive 'src' attributes |

#### Examples

> ```javascript
> import { renderConsole, iterator } from 'fileable';
> const main = async () =>
> renderConsole(template, { folder_context: '.' });
> main();
> ```

* * *

### function renderFS

Render file tree to file system

| Parameter                  | Type     | Description                                       |
| :------------------------- | :------- | :------------------------------------------------ |
| `input`                    | function |                                                   |
| `options`                  | object   |                                                   |
| `options.folder_context`   | string   | Folder into which files should be renddered       |
| `options.template_context` | string   | Location of template. Used to determine relateive |

#### Examples

> ```javascript
> import {renderFS} from 'fileable';
> const main = async () =>
> renderFS(template, { folder_context: '.' });
> main();
> ```

## Todo

- remove unnecessary dependencies
- add proper typescript typeings
- test multiple scenarious:
     - local input + remote templated
     - local input + local templated
     - remote input + remote templated
     - local input + local templated
     - no input + remote templated
     - no input + local templated
- create template component
