#!/usr/bin/env node
'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var fs = require('fs');
var yargs = _interopDefault(require('yargs'));
var findUp = _interopDefault(require('find-up'));
require('core-js/modules/es6.regexp.match');
require('regenerator-runtime/runtime');
var path = require('path');
var child_process = require('child_process');
var fetch = _interopDefault(require('node-fetch'));
require('core-js/modules/web.dom.iterable');
require('core-js/modules/es6.array.iterator');
require('core-js/modules/es6.object.to-string');
require('core-js/modules/es7.object.entries');
require('core-js/modules/es6.function.name');

function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) {
  try {
    var info = gen[key](arg);
    var value = info.value;
  } catch (error) {
    reject(error);
    return;
  }

  if (info.done) {
    resolve(value);
  } else {
    Promise.resolve(value).then(_next, _throw);
  }
}

function _asyncToGenerator(fn) {
  return function () {
    var self = this,
        args = arguments;
    return new Promise(function (resolve, reject) {
      var gen = fn.apply(self, args);

      function _next(value) {
        asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value);
      }

      function _throw(err) {
        asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err);
      }

      _next(undefined);
    });
  };
}

function _slicedToArray(arr, i) {
  return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _nonIterableRest();
}

function _arrayWithHoles(arr) {
  if (Array.isArray(arr)) return arr;
}

function _iterableToArrayLimit(arr, i) {
  var _arr = [];
  var _n = true;
  var _d = false;
  var _e = undefined;

  try {
    for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) {
      _arr.push(_s.value);

      if (i && _arr.length === i) break;
    }
  } catch (err) {
    _d = true;
    _e = err;
  } finally {
    try {
      if (!_n && _i["return"] != null) _i["return"]();
    } finally {
      if (_d) throw _e;
    }
  }

  return _arr;
}

function _nonIterableRest() {
  throw new TypeError("Invalid attempt to destructure non-iterable instance");
}

var node = path.join(__dirname, '../../node_modules/@babel/node/bin/babel-node.js --presets @babel/preset-react,@babel/preset-env ');
var CURRENT_RAND = Math.random();
var RAND_INDEX = 0;

var tempFileName = function tempFileName(parentDirectory) {
  var suffix = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  return path.join(parentDirectory, "".concat(CURRENT_RAND, "_").concat(RAND_INDEX++, ".temp").concat(suffix));
};

var regexp = /[^\s"]+|"([^"]*)"/gi;
var remoteFileMatch = /^(?:(?:https?)|(?:ftp)):\/\//;
var importPreamble = '';

var localizer = function localizer(path$1) {
  var defaultPath = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : undefined;
  return path$1 ? path.join(process.cwd(), path$1) : defaultPath;
};

var command = 'build <template> <destination>';
var describe = 'Build a file tree from template into destination directory.';
var builder = {
  test: {
    type: 'boolean',
    default: true,
    desc: 'write to console instead of fs'
  },
  input: {
    type: 'string',
    default: '',
    desc: 'imported input file (must export [asynchronous] iterator)'
  }
};
var handler =
/*#__PURE__*/
function () {
  var _ref2 = _asyncToGenerator(
  /*#__PURE__*/
  regeneratorRuntime.mark(function _callee(_ref) {
    var _ref$template, t, d, _ref$input, i, test, tempname, remoteTemplate, remoteInput, template, destination, input, template_context, response, text, _response, _text, file, array, match, ps;

    return regeneratorRuntime.wrap(function _callee$(_context) {
      while (1) {
        switch (_context.prev = _context.next) {
          case 0:
            _ref$template = _ref.template, t = _ref$template === void 0 ? '' : _ref$template, d = _ref.destination, _ref$input = _ref.input, i = _ref$input === void 0 ? '' : _ref$input, test = _ref.test;
            tempname = tempFileName(__dirname, '.js');
            _context.prev = 2;
            template = (t || '').match(remoteFileMatch) ? t : localizer(t);
            destination = localizer(d || tempFileName('', ''));
            input = i && i.match(remoteFileMatch) ? i : localizer(i || '');
            template_context = path.dirname(template);
            remoteTemplate = template.match(remoteFileMatch) && tempFileName(__dirname, '.jsx');
            remoteInput = input && input.match(remoteFileMatch) && tempFileName(__dirname, '.js');

            if (!remoteTemplate) {
              _context.next = 19;
              break;
            }

            _context.next = 12;
            return fetch(template);

          case 12:
            response = _context.sent;
            _context.next = 15;
            return response.text();

          case 15:
            text = _context.sent;
            fs.writeFileSync(remoteTemplate, "".concat(importPreamble).concat(text));
            _context.next = 20;
            break;

          case 19:
            if (template) {
              remoteTemplate = tempFileName(__dirname, '.jsx');
              fs.writeFileSync(remoteTemplate, importPreamble);
              fs.appendFileSync(remoteTemplate, fs.readFileSync(template));
            }

          case 20:
            if (!remoteInput) {
              _context.next = 30;
              break;
            }

            _context.next = 23;
            return fetch(input);

          case 23:
            _response = _context.sent;
            _context.next = 26;
            return _response.text();

          case 26:
            _text = _context.sent;
            fs.writeFileSync(remoteInput, _text);
            _context.next = 31;
            break;

          case 30:
            if (input) {
              remoteInput = tempFileName(__dirname, '.js');
              fs.copyFileSync(input, remoteInput);
            }

          case 31:
            file = "import template from '".concat(remoteTemplate, "';\nimport {render").concat(test ? 'Console' : 'FS', " as render} from \"../../dist/lib/index.js\";\n").concat(remoteInput ? "import args from \"".concat(remoteInput, "\";") : '', "\nconst main = async()=>{\n").concat(remoteInput ? "const input = [];\nfor await(const arg of args){\n    input.push(arg);\n}\n" : '', "\nrender(await template(").concat(remoteInput ? '... input' : '', "), {folder_context:'").concat(destination, "', template_context:'").concat(template_context, "'});\n}\nmain();\n// ");
            fs.writeFileSync(tempname, file);
            array = [];

            //https://stackoverflow.com/questions/2817646/javascript-split-string-on-space-or-on-quotes-to-array
            do {
              match = regexp.exec("".concat(node, " ").concat(tempname));

              if (match !== null) {
                array.push(match[1] ? match[1] : match[0]);
              }
            } while (match !== null);

            ps = child_process.spawn(array.shift(), array, {
              stdio: 'inherit',
              cwd: path.join(__dirname, '../../')
            });
            ps.on('close', function () {
              fs.unlinkSync(tempname);

              if (remoteTemplate) {
                fs.unlinkSync(remoteTemplate);
              }

              if (remoteInput) {
                fs.unlinkSync(remoteInput);
              }
            });
            _context.next = 45;
            break;

          case 39:
            _context.prev = 39;
            _context.t0 = _context["catch"](2);

            if (fs.existsSync(tempname)) {
              fs.unlinkSync(tempname);
            }

            if (remoteTemplate && fs.existsSync(remoteTemplate)) {
              fs.unlinkSync(remoteTemplate);
            }

            if (remoteInput && fs.existsSync(remoteInput)) {
              fs.unlinkSync(remoteInput);
            }

            throw _context.t0;

          case 45:
          case "end":
            return _context.stop();
        }
      }
    }, _callee, null, [[2, 39]]);
  }));

  return function handler(_x) {
    return _ref2.apply(this, arguments);
  };
}();

var build = /*#__PURE__*/Object.freeze({
  command: command,
  describe: describe,
  builder: builder,
  handler: handler
});

var command$1 = 'dependencies';
var describe$1 = 'List dependencies.';
var builder$1 = {};
var handler$1 =
/*#__PURE__*/
function () {
  var _ref = _asyncToGenerator(
  /*#__PURE__*/
  regeneratorRuntime.mark(function _callee() {
    var _require, dependencies, _i, _Object$entries, _Object$entries$_i, name, version;

    return regeneratorRuntime.wrap(function _callee$(_context) {
      while (1) {
        switch (_context.prev = _context.next) {
          case 0:
            _require = require('../../package.json'), dependencies = _require.dependencies;

            for (_i = 0, _Object$entries = Object.entries(dependencies); _i < _Object$entries.length; _i++) {
              _Object$entries$_i = _slicedToArray(_Object$entries[_i], 2), name = _Object$entries$_i[0], version = _Object$entries$_i[1];
              console.log("".concat(name, ": ").concat(version));
            }

          case 2:
          case "end":
            return _context.stop();
        }
      }
    }, _callee);
  }));

  return function handler() {
    return _ref.apply(this, arguments);
  };
}();

var dependencies = /*#__PURE__*/Object.freeze({
  command: command$1,
  describe: describe$1,
  builder: builder$1,
  handler: handler$1
});

var command$2 = 'install <name>';
var describe$2 = 'Install dependency';
var builder$2 = {};
var handler$2 =
/*#__PURE__*/
function () {
  var _ref2 = _asyncToGenerator(
  /*#__PURE__*/
  regeneratorRuntime.mark(function _callee(_ref) {
    var name;
    return regeneratorRuntime.wrap(function _callee$(_context) {
      while (1) {
        switch (_context.prev = _context.next) {
          case 0:
            name = _ref.name;
            return _context.abrupt("return", child_process.spawn('npm', ['install', '--prefix', path.join(__dirname, '../../'), name], {
              stdio: 'inherit' // cwd: join(__dirname, '../../')

            }));

          case 2:
          case "end":
            return _context.stop();
        }
      }
    }, _callee);
  }));

  return function handler(_x) {
    return _ref2.apply(this, arguments);
  };
}();

var install = /*#__PURE__*/Object.freeze({
  command: command$2,
  describe: describe$2,
  builder: builder$2,
  handler: handler$2
});

var command$3 = 'uninstall <name>';
var describe$3 = 'Uninstall dependency';
var builder$3 = {};
var handler$3 =
/*#__PURE__*/
function () {
  var _ref2 = _asyncToGenerator(
  /*#__PURE__*/
  regeneratorRuntime.mark(function _callee(_ref) {
    var name;
    return regeneratorRuntime.wrap(function _callee$(_context) {
      while (1) {
        switch (_context.prev = _context.next) {
          case 0:
            name = _ref.name;
            console.log('BE CAREFUL WHEN UNINSTALLING PACKAGES!!!');
            child_process.spawn('npm', ['uninstall', '--prefix', path.join(__dirname, '../../'), name], {
              stdio: 'inherit' // cwd: join(__dirname, '../../')

            });

          case 3:
          case "end":
            return _context.stop();
        }
      }
    }, _callee);
  }));

  return function handler(_x) {
    return _ref2.apply(this, arguments);
  };
}();

var uninstall = /*#__PURE__*/Object.freeze({
  command: command$3,
  describe: describe$3,
  builder: builder$3,
  handler: handler$3
});

var command$4 = 'template <path>';
var describe$4 = 'Create template from file tree';
var builder$4 = {
  interactive: {
    type: 'boolean',
    default: false,
    desc: 'Create template interactively'
  },
  binary: {
    type: 'string',
    default: true,
    desc: 'Algroithm used to handle binary files [auto|ask|base64|src|raw|skip]'
  }
};
var handler$4 =
/*#__PURE__*/
function () {
  var _ref2 = _asyncToGenerator(
  /*#__PURE__*/
  regeneratorRuntime.mark(function _callee(_ref) {
    var path, interactive;
    return regeneratorRuntime.wrap(function _callee$(_context) {
      while (1) {
        switch (_context.prev = _context.next) {
          case 0:
            path = _ref.path, interactive = _ref.interactive;
            console.log('NOT IMPLEMENTED!!!');

          case 2:
          case "end":
            return _context.stop();
        }
      }
    }, _callee);
  }));

  return function handler(_x) {
    return _ref2.apply(this, arguments);
  };
}(); // npm run fileable template  --interactive . output.jsx
// Adding folder 'top'...
// Folder 'top' added.
// Adding file 'top/index.html'
// File 'top/index.html' added.
// Adding file 'img.png'...
// File 'img.png' appears to be a binary file. How would you like to handle this?
// >-encode file as base64
// - add as src
// - use raw data
// - skip
// Encoding 'img.png' as base 64
// File 'img.png' added
// Adding 'index.js'...
// File 'index.js' added
// Tree traversed.
// Writing 'output.jsx'
// Done.

var template = /*#__PURE__*/Object.freeze({
  command: command$4,
  describe: describe$4,
  builder: builder$4,
  handler: handler$4
});

var configPath = findUp.sync(['.fileable', '.fileable.json']);
var config = configPath ? JSON.parse(fs.readFileSync(configPath)) : {};
yargs.config(config).command(build).command(dependencies).command(install).command(uninstall).command(template).demandCommand().recommendCommands().strict().help().alias('help', 'h').argv;
