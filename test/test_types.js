/* jshint node: true, mocha: true */

'use strict';

var types = require('../lib/types'),
    Tap = require('../lib/tap'),
    utils = require('../lib/utils'),
    assert = require('assert');


var AvscError = utils.AvscError;
var fromSchema = types.Type.fromSchema;

suite('types', function () {

  suite('PrimitiveType', function () {

    var data = [
      {
        schema: 'boolean',
        valid: [true, false],
        invalid: [null, 'hi', undefined, 1.5, 1e28, 123124123123213]
      },
      {
        schema: 'int',
        valid: [1, -3, 12314, 0, 1e9],
        invalid: [null, 'hi', undefined, 1.5, 1e28, 123124123123213]
      },
      {
        schema: 'long',
        valid: [1, -3, 12314, 9007199254740991],
        invalid: [null, 'hi', undefined, 9007199254740992, 1.3, 1e67]
      },
      {
        schema: 'string',
        valid: ['', 'hi'],
        invalid: [null, undefined, 1, 0]
      },
      {
        schema: 'null',
        valid: [null],
        invalid: [0, 1, 'hi', undefined]
      },
      {
        schema: 'float',
        valid: [1, -3.4, 12314e31],
        invalid: [null, 'hi', undefined, 5e38],
        check: function (a, b) { assert(floatEquals(a, b)); }
      },
      {
        schema: 'double',
        valid: [1, -3.4, 12314e31, 5e37],
        invalid: [null, 'hi', undefined],
        check: function (a, b) { assert(floatEquals(a, b), '' + [a, b]); }
      },
      {
        schema: 'bytes',
        valid: [new Buffer(1), new Buffer('abc')],
        invalid: [null, 'hi', undefined, 1, 0, -3.5]
      }
    ];

    var schemas = ['foo', ''];

    testType(types.PrimitiveType, data, schemas);

    test('toBuffer int', function () {

      var type = pType('int');
      assert.equal(type.fromBuffer(new Buffer([0x80, 0x01])), 64);
      assert(new Buffer([0]).equals(type.toBuffer(0)));

    });

    test('fromBuffer string', function () {

      var type = pType('string');
      var buf = new Buffer([0x06, 0x68, 0x69, 0x21]);
      var s = 'hi!';
      assert.equal(type.fromBuffer(buf), s);
      assert(buf.equals(type.toBuffer(s)));

    });

    test('toBuffer string', function () {

      var type = pType('string');
      var buf = new Buffer([0x06, 0x68, 0x69, 0x21]);
      assert(buf.equals(type.toBuffer('hi!', 1)));

    });

    test('resolve int > long', function () {
      var intType = pType('int');
      var longType = pType('long');
      var buf = intType.toBuffer(123);
      assert.equal(
        longType.fromBuffer(buf, longType.createResolver(intType)),
        123
      );
    });

    test('resolve int > [null, int]', function () {
      var wt = fromSchema('int');
      var rt = fromSchema(['null', 'int']);
      var buf = wt.toBuffer(123);
      assert.deepEqual(
        rt.fromBuffer(buf, rt.createResolver(wt)),
        {'int': 123}
      );
    });

    test('resolve string > bytes', function () {
      var stringT = pType('string');
      var bytesT = pType('bytes');
      var buf = stringT.toBuffer('\x00\x01');
      assert.deepEqual(
        bytesT.fromBuffer(buf, bytesT.createResolver(stringT)),
        new Buffer([0, 1])
      );
    });

    test('resolve invalid', function () {
      assert.throws(function () { getResolver('int', 'long'); }, AvscError);
      assert.throws(function () { getResolver('long', 'double'); }, AvscError);
    });

    test('toString', function () {
      assert.equal(pType('int').toString(), '"int"');
    });

    test('clone immutable', function () {
      var t = pType('int');
      assert.equal(t.clone(123), 123);
      assert.throws(function () { t.clone(''); }, AvscError);
    });

    test('clone bytes', function () {
      var t = pType('bytes');
      var s = '\x01\x02';
      var buf = new Buffer(s);
      var clone;
      clone = t.clone(buf);
      assert.deepEqual(clone, buf);
      clone[0] = 0;
      assert.equal(buf[0], 1);
      assert.throws(function () { t.clone(s); }, AvscError);
      clone = t.clone(s, {coerceBuffers: true});
      assert.deepEqual(clone, buf);
      clone = t.clone(buf.toJSON(), {coerceBuffers: true});
      assert.deepEqual(clone, buf);
      assert.throws(function () { t.clone(1, {coerceBuffers: true}); }, AvscError);
    });

    function pType(name) { return new types.PrimitiveType(name); }

  });

  suite('UnionType', function () {

    var data = [
      {
        name: 'null & string',
        schema: ['null', 'string'],
        valid: [null, {string: 'hi'}],
        invalid: ['null', undefined, {string: 1}],
        check: assert.deepEqual
      },
      {
        name: 'qualified name',
        schema: ['null', {type: 'fixed', name: 'a.B', size: 2}],
        valid: [null, {'a.B': new Buffer(2)}],
        invalid: [new Buffer(2)],
        check: assert.deepEqual
      },
      {
        name: 'array int',
        schema: ['null', {type: 'array', items: 'int'}],
        valid: [null, {array: [1,3]}],
        invalid: [{array: ['a']}, [4], 2],
        check: assert.deepEqual
      },
      {
        name: 'null',
        schema: ['null'],
        valid: [null],
        invalid: [{array: ['a']}, [4], 'null'],
        check: assert.deepEqual
      }
    ];

    var schemas = [
      {},
      [],
      ['null', 'null'],
      ['null', {type: 'map', values: 'int'}, {type: 'map', values: 'long'}]
    ];

    testType(types.UnionType, data, schemas);

    test('instanceof Union', function () {
      var type = new types.UnionType(['null', 'int']);
      assert(type instanceof types.UnionType);
    });

    test('missing name write', function () {
      var type = new types.UnionType(['null', 'int']);
      assert.throws(function () {
        type.toBuffer({b: 'a'});
      }, AvscError);
    });

    test('read invalid index', function () {
      var type = new types.UnionType(['null', 'int']);
      var buf = new Buffer([1, 0]);
      assert.throws(function () { type.fromBuffer(buf); }, AvscError);
    });

    test('non wrapped write', function () {
      var type = new types.UnionType(['null', 'int']);
      assert.throws(function () {
        type.toBuffer(1, true);
      }, Error);
    });

    test('to JSON', function () {
      var type = new types.UnionType(['null', 'int']);
      assert.equal(JSON.stringify(type), '["null","int"]');
    });

    test('resolve int to [long, int]', function () {
      var t1 = fromSchema('int');
      var t2 = fromSchema(['long', 'int']);
      var a = t2.createResolver(t1);
      var buf = t1.toBuffer(23);
      assert.deepEqual(t2.fromBuffer(buf, a), {'long': 23});
    });

    test('resolve null to [null, int]', function () {
      var t1 = fromSchema('null');
      var t2 = fromSchema(['null', 'int']);
      var a = t2.createResolver(t1);
      assert.deepEqual(t2.fromBuffer(new Buffer(0), a), null);
    });

    test('resolve [string, int] to [long, string]', function () {
      var t1 = fromSchema(['string', 'int']);
      var t2 = fromSchema(['int', 'bytes']);
      var a = t2.createResolver(t1);
      var buf;
      buf = t1.toBuffer({string: 'hi'});
      assert.deepEqual(t2.fromBuffer(buf, a), {'bytes': new Buffer('hi')});
      buf = t1.toBuffer({'int': 1});
      assert.deepEqual(t2.fromBuffer(buf, a), {'int': 1});
    });

    test('clone', function () {
      var t = new types.UnionType(['null', 'int']);
      var o = {'int': 1};
      assert.strictEqual(t.clone(null), null);
      var c = t.clone(o);
      assert.deepEqual(c, o);
      c.int = 2;
      assert.equal(o.int, 1);
      assert.throws(function () { t.clone([]); }, AvscError);
      assert.throws(function () { t.clone(undefined); }, AvscError);
    });

    test('clone and wrap', function () {
      var t = fromSchema(['string', 'int']);
      var s = 'hi!';
      var o = t.clone(s, {wrapUnions: true});
      assert.deepEqual(o, {'string': s});
      assert.throws(function () { t.clone(s); }, AvscError);
      assert.throws(function () {
        t.clone(1, {wrapUnions: true});
      }, AvscError);
    });

    test('invalid multiple keys', function () {
      var t = fromSchema(['null', 'int']);
      var o = {'int': 2};
      assert(t.isValid(o));
      o.foo = 3;
      assert(!t.isValid(o));
    });

    test('clone multiple keys', function () {
      var t = fromSchema(['null', 'int']);
      var o = {'int': 2, foo: 3};
      assert.throws(function () { t.clone(o); }, AvscError);
    });

    test('clone unqualified names', function () {
      var t = fromSchema({
        name: 'Person',
        type: 'record',
        fields: [
          {name: 'id1', type: {name: 'an.Id', type: 'fixed', size: 1}},
          {name: 'id2', type: ['null', 'an.Id']}
        ]
      });
      var b = new Buffer([0]);
      var o = {id1: b, id2: {Id: b}};
      assert.deepEqual(t.clone(o), {id1: b, id2: {'an.Id': b}});
    });

    test('clone unqualified names', function () {
      var t = fromSchema({
        name: 'Person',
        type: 'record',
        fields: [
          {name: 'id1', type: {name: 'Id', type: 'fixed', size: 1}},
          {name: 'id2', type: ['null', 'Id']}
        ]
      });
      var b = new Buffer([0]);
      var o = {id1: b, id2: {'an.Id': b}};
      assert.throws(function () { t.clone(o); }, AvscError);
    });

  });

  suite('EnumType', function () {

    var data = [
      {
        name: 'single symbol',
        schema: {name: 'Foo', symbols: ['HI']},
        valid: ['HI'],
        invalid: ['HEY', null, undefined, 0]
      },
      {
        name: 'number-ish as symbol',
        schema: {name: 'Foo', symbols: ['HI', 'A0']},
        valid: ['HI', 'A0'],
        invalid: ['HEY', null, undefined, 0, 'a0']
      }
    ];

    var schemas = [
      {name: 'Foo', symbols: []},
      {name: 'Foo'},
      {symbols: ['hi']},
      {name: 'G', symbols: ['0']}
    ];

    testType(types.EnumType, data, schemas);

    test('write invalid', function () {
      var type = fromSchema({type: 'enum', symbols: ['A'], name: 'a'});
      assert.throws(function () {
        type.toBuffer('B');
      }, AvscError);
    });

    test('read invalid index', function () {
      var type = new types.EnumType({type: 'enum', symbols: ['A'], name: 'a'});
      var buf = new Buffer([2]);
      assert.throws(function () { type.fromBuffer(buf); }, AvscError);
    });

    test('resolve', function () {
      var t1, t2, buf, resolver;
      t1 = newEnum('Foo', ['bar', 'baz']);
      t2 = newEnum('Foo', ['bar', 'baz']);
      resolver = t1.createResolver(t2);
      buf = t2.toBuffer('bar');
      assert.equal(t1.fromBuffer(buf, resolver), 'bar');
      t2 = newEnum('Foo', ['baz', 'bar']);
      buf = t2.toBuffer('bar');
      resolver = t1.createResolver(t2);
      assert.notEqual(t1.fromBuffer(buf), 'bar');
      assert.equal(t1.fromBuffer(buf, resolver), 'bar');
      t1 = newEnum('Foo2', ['foo', 'baz', 'bar'], ['Foo']);
      resolver = t1.createResolver(t2);
      assert.equal(t1.fromBuffer(buf, resolver), 'bar');
      t2 = newEnum('Foo', ['bar', 'bax']);
      assert.throws(function () { t1.createResolver(t2); }, AvscError);
      assert.throws(function () {
        t1.createResolver(fromSchema('int'));
      }, AvscError);
      function newEnum(name, symbols, aliases, namespace) {
        var obj = {type: 'enum', name: name, symbols: symbols};
        if (aliases !== undefined) {
          obj.aliases = aliases;
        }
        if (namespace !== undefined) {
          obj.namespace = namespace;
        }
        return new types.EnumType(obj);
      }
    });

    test('clone', function () {
      var t = fromSchema({type: 'enum', name: 'Foo', symbols: ['bar', 'baz']});
      assert.equal(t.clone('bar'), 'bar');
      assert.throws(function () { t.clone('BAR'); }, AvscError);
      assert.throws(function () { t.clone(null); }, AvscError);
    });

  });

  suite('FixedType', function () {

    var data = [
      {
        name: 'size 1',
        schema: {name: 'Foo', size: 2},
        valid: [new Buffer([1, 2]), new Buffer([2, 3])],
        invalid: ['HEY', null, undefined, 0, new Buffer(1), new Buffer(3)],
        check: function (a, b) { assert(a.equals(b)); }
      }
    ];

    var schemas = [
      {name: 'Foo', size: 0},
      {name: 'Foo', size: -2},
      {size: 2},
      {name: 'Foo'},
      {}
    ];

    testType(types.FixedType, data, schemas);

    test('resolve', function () {
      var t1 = new types.FixedType({name: 'Id', size: 4});
      var t2 = new types.FixedType({name: 'Id', size: 4});
      assert.doesNotThrow(function () { t2.createResolver(t1); });
      t2 = new types.FixedType({name: 'Id2', size: 4});
      assert.throws(function () { t2.createResolver(t1); }, AvscError);
      t2 = new types.FixedType({name: 'Id2', size: 4, aliases: ['Id']});
      assert.doesNotThrow(function () { t2.createResolver(t1); });
      t2 = new types.FixedType({name: 'Id2', size: 5, aliases: ['Id']});
      assert.throws(function () { t2.createResolver(t1); }, AvscError);
    });

    test('clone', function () {
      var t = new types.FixedType({name: 'Id', size: 2});
      var s = '\x01\x02';
      var buf = new Buffer(s);
      var clone;
      clone = t.clone(buf);
      assert.deepEqual(clone, buf);
      clone[0] = 0;
      assert.equal(buf[0], 1);
      assert.throws(function () { t.clone(s); }, AvscError);
      clone = t.clone(s, {coerceBuffers: true});
      assert.deepEqual(clone, buf);
      clone = t.clone(buf.toJSON(), {coerceBuffers: true});
      assert.deepEqual(clone, buf);
      assert.throws(function () { t.clone(1, {coerceBuffers: true}); }, AvscError);
      assert.throws(function () { t.clone(new Buffer([2])); }, AvscError);
    });

    test('toString schema with extra fields', function () {
      var t = fromSchema({type: 'fixed', name: 'Id', size: 2});
      t.one = 1;
      assert.equal(t.toString(), '{"name":"Id","type":"fixed","size":2}');
    });

  });

  suite('MapType', function () {

    var data = [
      {
        name: 'int',
        schema: {values: 'int'},
        valid: [{one: 1}, {two: 2, o: 0}],
        invalid: [1, {o: null}, [], undefined, {o: 'hi'}, {1: '', 2: 3}, ''],
        check: assert.deepEqual
      },
      {
        name: 'enum',
        schema: {values: {type: 'enum', name: 'a', symbols: ['A', 'B']}},
        valid: [{a: 'A'}, {a: 'A', b: 'B'}, {}],
        invalid: [{o: 'a'}, {1: 'A', 2: 'b'}, {a: 3}],
        check: assert.deepEqual
      },
      {
        name: 'array of string',
        schema: {values: {type: 'array', items: 'string'}},
        valid: [{a: []}, {a: ['A'], b: ['B', '']}, {}],
        invalid: [{o: 'a', b: []}, {a: [1, 2]}, {a: {b: ''}}],
        check: assert.deepEqual
      }
    ];

    var schemas = [
      {},
      {values: ''},
      {values: {type: 'array'}}
    ];

    testType(types.MapType, data, schemas);

    test('resolve int values to long values', function () {
      var t1 = new types.MapType({type: 'map', values: 'int'});
      var t2 = new types.MapType({type: 'map', values: 'long'});
      var resolver = t2.createResolver(t1);
      var obj = {one: 1, two: 2};
      var buf = t1.toBuffer(obj);
      assert.deepEqual(t2.fromBuffer(buf, resolver), obj);
    });

    test('resolve invalid', function () {
      var t1 = new types.MapType({type: 'map', values: 'int'});
      var t2 = new types.MapType({type: 'map', values: 'string'});
      assert.throws(function () { t2.createResolver(t1); }, AvscError);
      t2 = new types.ArrayType({type: 'array', items: 'string'});
      assert.throws(function () { t2.createResolver(t1); }, AvscError);
    });

    test('clone', function () {
      var t = new types.MapType({type: 'map', values: 'int'});
      var o = {one: 1, two: 2};
      var c = t.clone(o);
      assert.deepEqual(c, o);
      c.one = 3;
      assert.equal(o.one, 1);
      assert.throws(function () { t.clone(undefined); }, AvscError);
    });

    test('clone coerce buffers', function () {
      var t = new types.MapType({type: 'map', values: 'bytes'});
      var o = {one: '\x01'};
      assert.throws(function () { t.clone(o); });
      var c = t.clone(o, {coerceBuffers: true});
      assert.deepEqual(c, {one: new Buffer([1])});
    });

  });

  suite('ArrayType', function () {

    var data = [
      {
        name: 'int',
        schema: {items: 'int'},
        valid: [[1,3,4], []],
        invalid: [1, {o: null}, undefined, ['a'], [true]],
        check: assert.deepEqual
      }
    ];

    var schemas = [
      {},
      {items: ''},
    ];

    testType(types.ArrayType, data, schemas);

    test('resolve string items to bytes items', function () {
      var t1 = new types.ArrayType({type: 'array', items: 'string'});
      var t2 = new types.ArrayType({type: 'array', items: 'bytes'});
      var resolver = t2.createResolver(t1);
      var obj = ['\x01\x02'];
      var buf = t1.toBuffer(obj);
      assert.deepEqual(t2.fromBuffer(buf, resolver), [new Buffer([1, 2])]);
    });

    test('resolve invalid', function () {
      var t1 = new types.ArrayType({type: 'array', items: 'string'});
      var t2 = new types.ArrayType({type: 'array', items: 'long'});
      assert.throws(function () { t2.createResolver(t1); }, AvscError);
      t2 = new types.MapType({type: 'map', values: 'string'});
      assert.throws(function () { t2.createResolver(t1); }, AvscError);
    });

    test('clone', function () {
      var t = new types.ArrayType({type: 'array', items: 'int'});
      var o = [1, 2];
      var c = t.clone(o);
      assert.deepEqual(c, o);
      c.one = 3;
      assert.equal(o[0], 1);
      assert.throws(function () { t.clone({}); }, AvscError);
    });

    test('clone coerce buffers', function () {
      var ft = new types.FixedType({type: 'fixed', name: 'Id', size: 2});
      var t = new types.ArrayType({type: 'array', items: ft});
      var o = ['\x01\x02'];
      assert.throws(function () { t.clone(o); });
      var c = t.clone(o, {coerceBuffers: true});
      assert.deepEqual(c, [new Buffer([1, 2])]);
    });

  });

  suite('RecordType', function () {

    var data = [
      {
        name: 'union field null and string with default',
        schema: {
          type: 'record',
          name: 'a',
          fields: [{name: 'b', type: ['null', 'string'], 'default': null}]
        },
        valid: [],
        invalid: [],
        check: assert.deepEqual
      }
    ];

    var schemas = [
      {type: 'record', name: 'a', fields: ['null', 'string']},
      {type: 'record', name: 'a', fields: [{type: ['null', 'string']}]},
      {
        type: 'record',
        name: 'a',
        fields: [{name: 'b', type: ['null', 'string'], 'default': 'a'}]
      },
      {type: 'record', name: 'a', fields: {type: 'int', name: 'age'}}
    ];

    testType(types.RecordType, data, schemas);

    test('duplicate field names', function () {
      assert.throws(function () {
        fromSchema({
          type: 'record',
          name: 'Person',
          fields: [{name: 'age', type: 'int'}, {name: 'age', type: 'float'}]
        });
      }, AvscError);
    });

    test('default constructor', function () {
      var type = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'age', type: 'int', 'default': 25}]
      });
      var Person = type.getRecordConstructor();
      var p = new Person();
      assert.equal(p.age, 25);
    });

    test('default check & write', function () {
      var type = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'age', type: 'int', 'default': 25}]
      });
      assert.deepEqual(type.toBuffer({}), new Buffer([50]));
    });

    test('fixed string default', function () {
      var s = '\x01\x04';
      var b = new Buffer(s);
      var type = fromSchema({
        type: 'record',
        name: 'Object',
        fields: [
          {
            name: 'id',
            type: {type: 'fixed', size: 2, name: 'Id'},
            'default': s
          }
        ]
      });
      var obj = new (type.getRecordConstructor())();
      assert.deepEqual(obj.id, new Buffer([1, 4]));
      assert.deepEqual(type.toBuffer({}), b);
    });

    test('fixed buffer default', function () {
      var b = new Buffer([1, 4]);
      var type = fromSchema({
        type: 'record',
        name: 'Object',
        fields: [
          {
            name: 'id',
            type: {type: 'fixed', size: 2, name: 'Id'},
            'default': b
          }
        ]
      });
      assert.deepEqual(type.fields[0].getDefault(), b);
    });

    test('fixed buffer invalid default', function () {
      assert.throws(function () {
        fromSchema({
          type: 'record',
          name: 'Object',
          fields: [
            {
              name: 'id',
              type: {type: 'fixed', size: 2, name: 'Id'},
              'default': new Buffer([0])
            }
          ]
        });
      }, AvscError);
    });

    test('union invalid default', function () {
      assert.throws(function () {
        fromSchema({
          type: 'record',
          name: 'Person',
          fields: [{name: 'name', type: ['null', 'string'], 'default': ''}]
        });
      }, AvscError);
    });

    test('record default', function () {
      var d = {street: null, zip: 123};
      var Person = fromSchema({
        name: 'Person',
        type: 'record',
        fields: [
          {
            name: 'address',
            type: {
              name: 'Address',
              type: 'record',
              fields: [
                {name: 'street', type: ['null', 'string']},
                {name: 'zip', type: ['int', 'string']}
              ]
            },
            'default': d
          }
        ]
      }).getRecordConstructor();
      var p = new Person();
      assert.deepEqual(p.address, {street: null, zip: {'int': 123}});
    });

    test('record isValid', function () {
      var type = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'age', type: 'int'}]
      });
      var Person = type.getRecordConstructor();
      assert((new Person(20)).$isValid());
      assert(!(new Person()).$isValid());
      assert(!(new Person('a')).$isValid());
    });

    test('record toBuffer', function () {
      var type = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'age', type: 'int'}]
      });
      var Person = type.getRecordConstructor();
      assert.deepEqual((new Person(48)).$toBuffer(), new Buffer([96]));
      assert.throws(function () { (new Person()).$toBuffer(); });
      assert.doesNotThrow(function () {
        (new Person()).$toBuffer(true);
      });
    });

    test('Record type', function () {
      var type = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'age', type: 'int'}]
      });
      var Person = type.getRecordConstructor();
      assert.strictEqual(Person.type, type);
    });

    test('mutable defaults', function () {
      var Person = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [
          {
            name: 'friends',
            type: {type: 'array', items: 'string'},
            'default': []
          }
        ]
      }).getRecordConstructor();
      var p1 = new Person(undefined);
      assert.deepEqual(p1.friends, []);
      p1.friends.push('ann');
      var p2 = new Person(undefined);
      assert.deepEqual(p2.friends, []);
    });

    test('resolve alias', function () {
      var v1 = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'name', type: 'string'}]
      });
      var p = v1.random();
      var buf = v1.toBuffer(p);
      var v2 = fromSchema({
        type: 'record',
        name: 'Human',
        aliases: ['Person'],
        fields: [{name: 'name', type: 'string'}]
      });
      var resolver = v2.createResolver(v1);
      assert.deepEqual(v2.fromBuffer(buf, resolver), p);
      var v3 = fromSchema({
        type: 'record',
        name: 'Human',
        fields: [{name: 'name', type: 'string'}]
      });
      assert.throws(function () { v3.createResolver(v1); }, AvscError);
    });

    test('resolve alias with namespace', function () {
      var v1 = fromSchema({
        type: 'record',
        name: 'Person',
        namespace: 'earth',
        fields: [{name: 'name', type: 'string'}]
      });
      var v2 = fromSchema({
        type: 'record',
        name: 'Human',
        aliases: ['Person'],
        fields: [{name: 'name', type: 'string'}]
      });
      assert.throws(function () { v2.createResolver(v1); }, AvscError);
      var v3 = fromSchema({
        type: 'record',
        name: 'Human',
        aliases: ['earth.Person'],
        fields: [{name: 'name', type: 'string'}]
      });
      assert.doesNotThrow(function () { v3.createResolver(v1); });
    });

    test('resolve skip field', function () {
      var v1 = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [
          {name: 'age', type: 'int'},
          {name: 'name', type: 'string'}
        ]
      });
      var p = {age: 25, name: 'Ann'};
      var buf = v1.toBuffer(p);
      var v2 = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'name', type: 'string'}]
      });
      var resolver = v2.createResolver(v1);
      assert.deepEqual(v2.fromBuffer(buf, resolver), {name: 'Ann'});
    });

    test('resolve new field', function () {
      var v1 = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'name', type: 'string'}]
      });
      var p = {name: 'Ann'};
      var buf = v1.toBuffer(p);
      var v2 = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [
          {name: 'age', type: 'int', 'default': 25},
          {name: 'name', type: 'string'}
        ]
      });
      var resolver = v2.createResolver(v1);
      assert.deepEqual(v2.fromBuffer(buf, resolver), {name: 'Ann', age: 25});
    });

    test('resolve new field no default', function () {
      var v1 = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'name', type: 'string'}]
      });
      var v2 = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [
          {name: 'age', type: 'int'},
          {name: 'name', type: 'string'}
        ]
      });
      assert.throws(function () { v2.createResolver(v1); }, AvscError);
    });

    test('resolve from recursive schema', function () {
      var v1 = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'friends', type: {type: 'array', items: 'Person'}}]
      });
      var v2 = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'age', type: 'int', 'default': -1}]
      });
      var resolver = v2.createResolver(v1);
      var p1 = {friends: [{friends: []}]};
      var p2 = v2.fromBuffer(v1.toBuffer(p1), resolver);
      assert.deepEqual(p2, {age: -1});
    });

    test('resolve to recursive schema', function () {
      var v1 = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'age', type: 'int', 'default': -1}]
      });
      var v2 = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [
          {
            name: 'friends',
            type: {type: 'array', items: 'Person'},
            'default': []
          }
        ]
      });
      var resolver = v2.createResolver(v1);
      var p1 = {age: 25};
      var p2 = v2.fromBuffer(v1.toBuffer(p1), resolver);
      assert.deepEqual(p2, {friends: []});
    });

    test('resolve from both recursive schema', function () {
      var v1 = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [
          {name: 'friends', type: {type: 'array', items: 'Person'}},
          {name: 'age', type: 'int'}
        ]
      });
      var v2 = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'friends', type: {type: 'array', items: 'Person'}}]
      });
      var resolver = v2.createResolver(v1);
      var p1 = {friends: [{age: 1, friends: []}], age: 10};
      var p2 = v2.fromBuffer(v1.toBuffer(p1), resolver);
      assert.deepEqual(p2, {friends: [{friends: []}]});
    });

    test('resolve multiple matching aliases', function () {
      var v1 = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [
          {name: 'phone', type: 'string'},
          {name: 'number', type: 'string'}
        ]
      });
      var v2 = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'number', type: 'string', aliases: ['phone']}]
      });
      assert.throws(function () { v2.createResolver(v1); }, AvscError);
    });

    test('toString schema', function () {
      var t = fromSchema({
        type: 'record',
        name: 'Person',
        doc: 'Hi!',
        namespace: 'earth',
        aliases: ['Human'],
        fields: [
          {name: 'friends', type: {type: 'array', items: 'string'}},
          {name: 'age', aliases: ['years'], type: {type: 'int'}}
        ]
      });
      assert.equal(
        t.toString(),
        '{"name":"earth.Person","type":"record","fields":[{"name":"friends","type":{"type":"array","items":"string"}},{"name":"age","type":"int"}]}'
      );
    });

    test('toString recursive schema', function () {
      var t = fromSchema({
        type: 'record',
        name: 'Person',
        namespace: 'earth',
        fields: [
          {name: 'friends', type: {type: 'array', items: 'Person'}},
        ]
      });
      assert.equal(
        t.toString(),
        '{"name":"earth.Person","type":"record","fields":[{"name":"friends","type":{"type":"array","items":"earth.Person"}}]}'
      );
    });

    test('toString record', function () {
      var T = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'pwd', type: 'bytes'}]
      }).getRecordConstructor();
      var r = new T(new Buffer([1, 2]));
      assert.equal(r.$toString(), T.type.toString(r));
    });

    test('clone', function () {
      var t = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'age', type: 'int'}, {name: 'name', type: 'string'}]
      });
      var Person = t.getRecordConstructor();
      var o = {age: 25, name: 'Ann'};
      var c = t.clone(o);
      assert.deepEqual(c, o);
      assert(c instanceof Person);
      c.age = 26;
      assert.equal(o.age, 25);
    });

    test('clone field hook', function () {
      var t = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'age', type: 'int'}, {name: 'name', type: 'string'}]
      });
      var o = {name: 'Ann', age: 25};
      var c = t.clone(o, {fieldHook: function (o, r) {
        assert.strictEqual(r, t);
        return this.type.type === 'string' ? o.toUpperCase() : o;
      }});
      assert.deepEqual(c, {name: 'ANN', age: 25});
    });

  });

  suite('fromSchema', function  () {

    test('null type', function () {
      assert.throws(function () { fromSchema(null); }, AvscError);
    });

    test('unknown types', function () {
      assert.throws(function () { fromSchema('a'); }, AvscError);
      assert.throws(function () { fromSchema({type: 'b'}); }, AvscError);
    });

    test('namespaced type', function () {
      var type = fromSchema({
        type: 'record',
        name: 'Human',
        namespace: 'earth',
        fields: [
          {
            name: 'id',
            type: {type: 'fixed', name: 'Id', size: 2, namespace: 'all'}
          },
          {
            name: 'alien',
            type: {
              type: 'record',
              name: 'Alien',
              namespace: 'all',
              fields: [
                {name: 'friend', type: 'earth.Human'},
                {name: 'id', type: 'Id'},
              ]
            }
          }
        ]
      });
      assert.equal(type.name, 'earth.Human');
      assert.equal(type.fields[0].type.name, 'all.Id');
      assert.equal(type.fields[1].type.name, 'all.Alien');
    });

    test('wrapped primitive', function () {
      var type = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'nothing', type: {type: 'null'}}]
      });
      assert.equal(type.fields[0].type.type, 'null');
    });

    test('fromBuffer truncated', function () {
      var type = fromSchema('int');
      assert.throws(function () {
        type.fromBuffer(new Buffer([128]));
      }, AvscError);
    });

    test('fromBuffer bad resolver', function () {
      var type = fromSchema('int');
      assert.throws(function () {
        type.fromBuffer(new Buffer([0]), 123, {});
      }, AvscError);
    });

    test('fromBuffer trailing', function () {
      var type = fromSchema('int');
      assert.throws(function () {
        type.fromBuffer(new Buffer([0, 2]));
      }, AvscError);
    });

    test('fromBuffer trailing with resolver', function () {
      var type = fromSchema('int');
      var resolver = type.createResolver(fromSchema(['int']));
      assert.equal(type.fromBuffer(new Buffer([0, 2]), resolver), 1);
    });

    test('toBuffer strict & not', function () {
      var type = fromSchema('int');
      assert.throws(function () { type.toBuffer('abc'); }, AvscError);
      type.toBuffer('abc', true);
    });

    test('toBuffer and resize', function () {
      var type = fromSchema('string');
      assert.deepEqual(type.toBuffer('\x01', 1), new Buffer([2, 1]));
    });

    test('type hook', function () {
      var c = {};
      var o = {
        type: 'record',
        name: 'Human',
        fields: [
          {name: 'age', type: 'int'},
          {name: 'name', type: {type: 'string'}}
        ]
      };
      fromSchema(o, {typeHook: function (s) { c[this.type] = s; }});
      assert.strictEqual(c.record, o);
      assert.strictEqual(c.string, o.fields[1].type);
    });

    test('fingerprint', function () {
      var t = fromSchema('int');
      var buf = new Buffer('ef524ea1b91e73173d938ade36c1db32', 'hex');
      assert.deepEqual(t.createFingerprint('md5'), buf);
      assert.deepEqual(t.createFingerprint(), buf);
    });

    test('toString default', function () {
      var schema = {
        type: 'record',
        name: 'Human',
        fields: [
          {
            name: 'id1',
            type: ['string', 'null'],
            'default': ''
          },
          {
            name: 'id2',
            type: ['null', 'string'],
            'default': null
          }
        ]
      };
      var type = fromSchema(schema);
      assert.deepEqual(JSON.parse(type.toString()), schema);
    });

  });

  suite('fromString', function () {

    test('int', function () {
      var t = fromSchema('int');
      assert.equal(t.fromString('2'), 2);
      assert.throws(function () { t.fromString('"a"'); });
    });

    test('string', function () {
      var t = fromSchema('string');
      assert.equal(t.fromString('"2"'), '2');
      assert.throws(function () { t.fromString('a'); });
    });

    test('coerce buffers', function () {
      var t = fromSchema({
        name: 'Ids',
        type: 'record',
        fields: [{name: 'id1', type: {name: 'Id1', type: 'fixed', size: 2}}]
      });
      var o = {id1: new Buffer([0, 1])};
      var s = '{"id1": "\\u0000\\u0001"}';
      var c = t.fromString(s);
      assert.deepEqual(c, o);
      assert(c instanceof t.getRecordConstructor());
    });

  });

  suite('resolve unions', function () {

    test('to valid union', function () {
      var t1 = fromSchema(['int', 'string']);
      var t2 = fromSchema(['null', 'string', 'long']);
      var resolver = t2.createResolver(t1);
      var buf = t1.toBuffer({'int': 12});
      assert.deepEqual(t2.fromBuffer(buf, resolver), {'long': 12});
    });

    test('to invalid union', function () {
      var t1 = fromSchema(['int', 'string']);
      var t2 = fromSchema(['null', 'long']);
      assert.throws(function () { t2.createResolver(t1); }, AvscError);
    });

    test('to non union', function () {
      var t1 = fromSchema(['int', 'long']);
      var t2 = fromSchema('long');
      var resolver = t2.createResolver(t1);
      var buf = t1.toBuffer({'int': 12});
      assert.equal(t2.fromBuffer(buf, resolver), 12);
      buf = new Buffer([4, 0]);
      assert.throws(function () { t2.fromBuffer(buf, resolver); }, AvscError);
    });

    test('to invalid non union', function () {
      var t1 = fromSchema(['int', 'long']);
      var t2 = fromSchema('int');
      assert.throws(function() { t2.createResolver(t1); }, AvscError);
    });

  });

  suite('type names', function () {

    test('existing', function () {
      var type = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [{name: 'so', type: 'Person'}]
      });
      assert.strictEqual(type, type.fields[0].type);
    });

    test('namespaced', function () {
      var type = fromSchema({
        type: 'record',
        name: 'Person',
        fields: [
          {
            name: 'so',
            type: {
              type: 'record',
              name: 'Person',
              fields: [{name: 'age', type: 'int'}],
              namespace: 'a'
            }
          }
        ]
      });
      assert.equal(type.name, 'Person');
      assert.equal(type.fields[0].type.name, 'a.Person');
    });

    test('redefining', function () {
      assert.throws(function () {
        fromSchema({
          type: 'record',
          name: 'Person',
          fields: [
            {
              name: 'so',
              type: {
                type: 'record',
                name: 'Person',
                fields: [{name: 'age', type: 'int'}]
              }
            }
          ]
        });
      }, AvscError);
    });

    test('missing', function () {
      assert.throws(function () {
        fromSchema({
          type: 'record',
          name: 'Person',
          fields: [{name: 'so', type: 'Friend'}]
        });
      }, AvscError);
    });

    test('redefining primitive', function () {
      assert.throws( // Unqualified.
        function () { fromSchema({type: 'fixed', name: 'int', size: 2}); },
        AvscError
      );
      assert.throws( // Qualified.
        function () {
          fromSchema({type: 'fixed', name: 'int', size: 2, namespace: 'a'});
        },
        AvscError
      );
    });

    test('aliases', function () {
      var type = fromSchema({
        type: 'record',
        name: 'Person',
        namespace: 'a',
        aliases: ['Human', 'b.Being'],
        fields: [{name: 'age', type: 'int'}]
      });
      assert.deepEqual(type.aliases, ['a.Human', 'b.Being']);
    });

  });

  test('reset', function () {
    types.Type.__reset(0);
    var t = fromSchema('string');
    var buf = t.toBuffer('\x01');
    assert.deepEqual(buf, new Buffer([2, 1]));
  });

});

function testType(Type, data, invalidSchemas) {

  data.forEach(function (elem) {
    test(elem.name || elem.schema, function () {
      var type = new Type(elem.schema);
      elem.valid.forEach(function (v) {
        assert(type.isValid(v), '' + v);
        var fn = elem.check || assert.deepEqual;
        fn(type.fromBuffer(type.toBuffer(v)), v);
        fn(type.fromString(type.toString(v), {coerceBuffers: true}), v);
      });
      elem.invalid.forEach(function (v) {
        assert(!type.isValid(v), '' + v);
      });
      var n = 50;
      while (n--) {
        // Run a few times to make sure we cover any branches.
        assert(type.isValid(type.random()));
      }
    });
  });

  test('skip', function () {
    data.forEach(function (elem) {
      var fn = elem.check || assert.deepEqual;
      var items = elem.valid;
      if (items.length > 1) {
        var type = new Type(elem.schema);
        var buf = new Buffer(1024);
        var tap = new Tap(buf);
        type._write(tap, items[0]);
        type._write(tap, items[1]);
        tap.pos = 0;
        type._skip(tap);
        fn(type._read(tap), items[1]);
      }
    });
  });

  test('invalid', function () {
    invalidSchemas.forEach(function (schema) {
      assert.throws(function () { new Type(schema); }, AvscError);
    });
  });

}

function getResolver(reader, writer) {

  return fromSchema(reader).createResolver(fromSchema(writer));

}

function floatEquals(a, b) {

  return Math.abs((a - b) / Math.min(a, b)) < 1e-7;

}