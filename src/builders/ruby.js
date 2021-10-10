'use strict';

class Builder {
  static create (filename) {
    var builder = new Builder();
    builder.filename = filename;
    return builder;
  }

  constructor (parent) {
    if (parent) {
      this._parent = parent;
      this._indentLevel = parent._indentLevel;
    } else {
      this._buffer = '';
      this._indentLevel = 0;
    }
    this._methodSeparator = '';
    this._varIndex = {};
  }

  comment (lines) {
    return lines.map((line) => '# ' + line);
  }

  serialize () {
    var files = {};
    files[this._outputPathname()] = this._buffer;
    return files;
  }

  _outputPathname () {
    return this.filename.replace(/\.peg$/, '.rb');
  }

  _write (string) {
    if (this._parent) return this._parent._write(string);
    this._buffer += string;
  }

  _indent (block, context) {
    this._indentLevel += 1;
    block.call(context, this);
    this._indentLevel -= 1;
  }

  _newline () {
    this._write('\n');
  }

  _line (source) {
    var i = this._indentLevel;
    while (i--) this._write('  ');
    this._write(source);
    this._newline();
  }

  _quote (string) {
    string = string.replace(/\\/g, '\\\\')
                   .replace(/"/g, '\\"')
                   .replace(/#\{/g, '\\#{')
                   .replace(/\x07/g, '\\a')
                   .replace(/\x08/g, '\\b')
                   .replace(/\t/g, '\\t')
                   .replace(/\n/g, '\\n')
                   .replace(/\v/g, '\\v')
                   .replace(/\f/g, '\\f')
                   .replace(/\r/g, '\\r')
                   .replace(/\x1b/g, '\\e');

    return '"' + string + '"';
  }

  package_ (name, block, context) {
    this._line('module ' + name.replace(/\./g, '::'));
    this._indent(block, context);
    this._line('end');
  }

  syntaxNodeClass_ () {
    var name = 'TreeNode';
    this._line('class ' + name);
    this._indent((builder) => {
      builder._line('include Enumerable');
      builder.attributes_(['text', 'offset', 'elements']);
      builder.method_('initialize', ['text', 'offset', 'elements'], (builder) => {
        builder.attribute_('text', 'text');
        builder.attribute_('offset', 'offset');
        builder.attribute_('elements', 'elements');
      });
      builder.method_('each', ['&block'], (builder) => {
        builder._line('@elements.each(&block)');
      });
    });
    this._line('end');
    this._newline();
    return name;
  }

  grammarModule_ (actions, block, context) {
    this.assign_('ParseError', 'Class.new(StandardError)');
    this._newline();
    this.assign_(this.nullNode_(), 'Object.new');
    this._newline();
    this._line('module Grammar');
    new Builder(this)._indent(block, context);
    this._line('end');
    this._newline();
  }

  compileRegex_ () {}

  parserClass_ (root) {
    this._line('class Parser');
    this._indent((builder) => {
      builder._line('include Grammar');
      builder._methodSeparator = '\n';

      builder.method_('initialize', ['input', 'actions', 'types'], (builder) => {
        builder.attribute_('input', 'input');
        builder.attribute_('input_size', 'input.size');
        builder.attribute_('actions', 'actions');
        builder.attribute_('types', 'types');
        builder.attribute_('offset', '0');
        builder.attribute_('cache', 'Hash.new { |h,k| h[k] = {} }');
        builder.attribute_('failure', '0');
        builder.attribute_('expected', '[]');
      });

      builder.method_('parse', [], (builder) => {
        builder.jump_('tree', root);
        builder.if_('tree != ' + builder.nullNode_() + ' and @offset == @input_size', (builder) => {
          builder.return_('tree');
        });
        builder.if_('@expected.empty?', (builder) => {
          builder.assign_('@failure', '@offset');
          builder.append_('@expected', '"<EOF>"');
        });
        builder._line('raise ParseError, Parser.format_error(@input, @failure, @expected)');
      });

      builder.method_('self.format_error', ['input', 'offset', 'expected'], (builder) => {
        builder._line('lines, line_no, position = input.split(/\\n/), 0, 0');
        builder._line('while position <= offset');
        builder._indent((builder) => {
          builder._line('position += lines[line_no].size + 1');
          builder._line('line_no += 1');
        });
        builder._line('end');
        builder._line('message, line = "Line #{line_no}: expected #{expected * ", "}\\n", lines[line_no - 1]');
        builder._line('message += "#{line}\\n"');
        builder._line('position -= line.size + 1');
        builder._line('message += " " * (offset - position)');
        builder.return_('message + "^"');
      });
    });
    this._line('end');
    this._newline();
  }

  exports_ () {
    this._line('def self.parse(input, options = {})');
    this._indent((builder) => {
      builder.assign_('parser', 'Parser.new(input, options[:actions], options[:types])');
      builder._line('parser.parse');
    });
    this._line('end');
  }

  class_ (name, parent, block, context) {
    this._line('class ' + name + ' < ' + parent);
    new Builder(this)._indent(block, context);
    this._line('end');
    this._newline();
  }

  constructor_ (args, block, context) {
    this.method_('initialize', args, (builder) => {
      builder._line('super');
      block.call(context, builder);
    });
  }

  method_ (name, args, block, context) {
    this._write(this._methodSeparator);
    this._methodSeparator = '\n';
    args = (args.length > 0) ? '(' + args.join(', ') + ')' : '';
    this._line('def ' + name + args);
    new Builder(this)._indent(block, context);
    this._line('end');
  }

  cache_ (name, block, context) {
    var temp      = this.localVars_({address: this.nullNode_(), index: '@offset'}),
        address   = temp.address,
        offset    = temp.index,
        cacheMap  = '@cache[:' + name + ']',
        cacheAddr = cacheMap + '[' + offset + ']';

    this.assign_('cached', cacheAddr);

    this.if_('cached', (builder) => {
      builder._line('@offset = cached[1]');
      builder.return_('cached[0]');
    }, this);

    block.call(context, this, address);
    this.assign_(cacheAddr, '[' + address + ', @offset]');
    this.return_(address);
  }

  attributes_ (names) {
    var keys = [];
    for (var i = 0, n = names.length; i < n; i++) keys.push(':' + names[i]);
    this._line('attr_reader ' + keys.join(', '));
    this._methodSeparator = '\n';
  }

  attribute_ (name, value) {
    this.assign_('@' + name, value);
  }

  localVars_ (vars) {
    var names = {}, lhs = [], rhs = [], varName;
    for (var name in vars) {
      this._varIndex[name] = this._varIndex[name] || 0;
      varName = name + this._varIndex[name];
      this._varIndex[name] += 1;
      lhs.push(varName);
      rhs.push(vars[name]);
      names[name] = varName;
    }
    this.assign_(lhs.join(', '), rhs.join(', '));
    return names;
  }

  localVar_ (name, value) {
    this._varIndex[name] = this._varIndex[name] || 0;
    var varName = name + this._varIndex[name];
    this._varIndex[name] += 1;

    if (value === undefined) value = this.nullNode_();
    this.assign_(varName, value);

    return varName;
  }

  chunk_ (length) {
    var input = '@input',
        ofs   = '@offset',
        temp  = this.localVars_({chunk: this.null_(), max: ofs + ' + ' + length});

    this.if_(temp.max + ' <= @input_size', (builder) => {
      builder.assign_(temp.chunk, input + '[' + ofs + '...' + temp.max + ']');
    });
    return temp.chunk;
  }

  syntaxNode_ (address, start, end, elements, action, nodeClass) {
    var args;

    if (action) {
      action = '@actions.' + action;
      args   = ['@input', start, end];
    } else {
      action = (nodeClass || 'TreeNode') + '.new';
      args   = ['@input[' + start + '...' + end + ']', start];
    }
    args.push(elements || this.emptyList_());

    this.assign_(address, action + '(' + args.join(', ') + ')');
    this.assign_('@offset', end);
  }

  ifNode_ (address, block, else_, context) {
    this.unless_(address + ' == ' + this.nullNode_(), block, else_, context);
  }

  unlessNode_ (address, block, else_, context) {
    this.if_(address + ' == ' + this.nullNode_(), block, else_, context);
  }

  ifNull_ (elements, block, else_, context) {
    this.if_(elements + '.nil?', block, else_, context);
  }

  extendNode_ (address, nodeType) {
    this._line(address + '.extend(@types::' + nodeType.replace(/\./g, '::') + ')');
  }

  failure_ (address, expected) {
    expected = this._quote(expected);
    this.assign_(address, this.nullNode_());

    this.if_('@offset > @failure', (builder) => {
      builder.assign_('@failure', '@offset');
      builder.assign_('@expected', '[]');
    });
    this.if_('@offset == @failure', (builder) => {
      builder.append_('@expected', expected);
    });
  }

  assign_ (name, value) {
    this._line(name + ' = ' + value);
  }

  jump_ (address, name) {
    this.assign_(address, '_read_' + name);
  }

  conditional_ (type, condition, block, else_, context) {
    if (typeof else_ !== 'function') {
      context = else_;
      else_   = null;
    }
    this._line(type + ' ' + condition);
    this._indent(block, context);
    if (else_) {
      this._line('else');
      this._indent(else_, context);
    }
    this._line('end');
  }

  if_ (condition, block, else_, context) {
    this.conditional_('if', condition, block, else_, context);
  }

  unless_ (condition, block, else_, context) {
    this.conditional_('unless', condition, block, else_, context);
  }

  whileNotNull_ (expression, block, context) {
    this._line('until ' + expression + ' == ' + this.nullNode_());
    this._indent(block, context);
    this._line('end');
  }

  stringMatch_ (expression, string) {
    return expression + ' == ' + this._quote(string);
  }

  stringMatchCI_ (expression, string) {
    return '!' + expression + '.nil? && ' +
      expression + '.downcase == ' + this._quote(string) + '.downcase';
  }

  regexMatch_ (regex, string) {
    var source = regex.source.replace(/^\^/g, '\\A');
    return string + ' =~ /' + source + '/';
  }

  return_ (expression) {
    this._line('return ' + expression);
  }

  arrayLookup_ (expression, index) {
    return expression + '[' + index + ']';
  }

  append_ (list, value) {
    this._line(list + ' << ' + value);
  }

  decrement_ (variable) {
    this._line(variable + ' -= 1');
  }

  hasChars_ () {
    return '@offset < @input_size';
  }

  isZero_ (expression) {
    return expression + ' <= 0';
  }

  nullNode_ () {
    return 'FAILURE';
  }

  offset_ () {
    return '@offset';
  }

  emptyList_ () {
    return '[]';
  }

  emptyString_ () {
    return '""';
  }

  true_ () {
    return 'true';
  }

  null_ () {
    return 'nil';
  }
}

module.exports = Builder;
