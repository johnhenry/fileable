#!/usr/bin/env node
'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var fs = require('fs');
var fs__default = _interopDefault(fs);
var yargs = _interopDefault(require('yargs'));
var findUp = _interopDefault(require('find-up'));
require('core-js/modules/es6.regexp.match');
require('regenerator-runtime/runtime');
var path = require('path');
var child_process = require('child_process');
var fetch = _interopDefault(require('node-fetch'));

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

var node = path.join(__dirname, '../../node_modules/@babel/node/bin/babel-node.js --presets @babel/preset-react,@babel/preset-env --plugins @babel/plugin-syntax-dynamic-import');

var tempFileName = function tempFileName(parentDirectory) {
  var suffix = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  return path.join(parentDirectory, "".concat(Math.random(), ".temp").concat(suffix));
};

var regexp = /[^\s"]+|"([^"]*)"/gi;
var remoteFileMatch = /^(?:(?:https?)|(?:ftp)):\/\//;
var command = 'build <template> <destination>';
var describe = 'Build a file tree from template into destination directory';
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

var localizer = function localizer(path$1) {
  var defaultPath = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : undefined;
  return path$1 ? path.join(process.cwd(), path$1) : defaultPath;
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
            template = t.match(remoteFileMatch) ? t : localizer(t);
            destination = localizer(d || tempFileName('', ''));
            input = i.match(remoteFileMatch) ? i : localizer(i);
            template_context = path.dirname(template);
            remoteTemplate = template.match(remoteFileMatch) && tempFileName(__dirname, '.js');
            remoteInput = input.match(remoteFileMatch) && tempFileName(__dirname, '.js');

            if (!remoteTemplate) {
              _context.next = 17;
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
            fs__default.writeFileSync(remoteTemplate, "import { File, Clear, Folder } from '../../';\n".concat(text));

          case 17:
            if (!remoteInput) {
              _context.next = 25;
              break;
            }

            _context.next = 20;
            return fetch(input);

          case 20:
            _response = _context.sent;
            _context.next = 23;
            return _response.text();

          case 23:
            _text = _context.sent;
            fs__default.writeFileSync(remoteInput, _text);

          case 25:
            file = "import template from '".concat(remoteTemplate || template, "';\nimport {render").concat(test ? 'Console' : 'FS', " as render} from \"../../dist/lib/index.js\";\n").concat(input ? "import args from \"".concat(remoteInput || input, "\";") : '', "\nconst main = async()=>{\n").concat(input ? "const input = [];\nfor await(const arg of args){\n    input.push(arg);\n}\n" : '', "\nrender(await template(").concat(input ? '... input' : '', "), {folder_context:['").concat(destination, "'], template_context:'").concat(template_context, "'});\n}\nmain();\n// ");

            require('@babel/core').transform(file, {
              plugins: ['@babel/plugin-syntax-dynamic-import'],
              presets: ['@babel/preset-react', '@babel/preset-env']
            });

            fs__default.writeFileSync(tempname, file);
            array = [];

            //https://stackoverflow.com/questions/2817646/javascript-split-string-on-space-or-on-quotes-to-array
            do {
              match = regexp.exec("".concat(node, " ").concat(tempname));

              if (match !== null) {
                array.push(match[1] ? match[1] : match[0]);
              }
            } while (match !== null);

            ps = child_process.spawn(array.shift(), array, {
              stdio: 'inherit'
            });
            ps.on('close', function () {
              fs__default.unlinkSync(tempname);

              if (remoteTemplate) {
                fs__default.unlinkSync(remoteTemplate);
              }

              if (remoteInput) {
                fs__default.unlinkSync(remoteInput);
              }
            });
            _context.next = 40;
            break;

          case 34:
            _context.prev = 34;
            _context.t0 = _context["catch"](2);

            if (fs__default.existsSync(tempname)) {
              fs__default.unlinkSync(tempname);
            }

            if (remoteTemplate && fs__default.existsSync(remoteTemplate)) {
              fs__default.unlinkSync(remoteTemplate);
            }

            if (remoteInput && fs__default.existsSync(remoteInput)) {
              fs__default.unlinkSync(remoteInput);
            }

            throw _context.t0;

          case 40:
          case "end":
            return _context.stop();
        }
      }
    }, _callee, null, [[2, 34]]);
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

var configPath = findUp.sync(['.fileable', '.fileable.json']);
var config = configPath ? JSON.parse(fs.readFileSync(configPath)) : {};
yargs.config(config).command(build).demandCommand().recommendCommands().strict().help().alias('help', 'h').argv;
