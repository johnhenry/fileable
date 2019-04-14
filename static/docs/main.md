![fileable logo](./static/docs/logo.png)

# Fileable

Render a file tree using a JSX template.

Inspired by [React FS Renderer](https://github.com/ericvicenti/react-fs-renderer)

For the command line application, see [fileable-cli](https://github.com/johnhenry/fileable-cli)

## Installation

```sh
npm install fileable
```

## Usage

## Bacis Usage

```javascript
import {renderFS} from 'fileable';
import template from './path/to/sample-template.jsx';
const template_context = './path/to/';
const folder_context = './destination'
renderFS(template, { folder_context, template_context});
```

Usage is similar for 'renderConsole';

### Templates Files

Templates are jsx files. The default export will be used to generate a file tree.
(Note: You must always include a reference to 'React');
```javascript
import React from 'react';
export default ()=><></>;
```

#### Components

By default, the [React.Fragment]() is available, but

```javascript
import React from 'react';
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

See [fileable-components](https://github.com/johnhenry/fileable-components) for a list of components  and to learn how to build your own.

Note: components are composable and extentable.

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

## API

### renderFS

Renders file tree to file system.

### renderConsole

Renders file tree to console

### iterator
