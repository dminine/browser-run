var http = require('http');
var path = require('path');
var spawn = require('child_process').spawn;
var through = require('through');
var duplex = require('duplexer');
var fs = require('fs');
var xws = require('xhr-write-stream')();
var enstore = require('enstore');
var launch = require('./lib/launch');
var ecstatic = require('ecstatic');
var injectScript = require('html-inject-script');
var destroyable = require('server-destroy');
var extend = require('xtend');
var url = require('url');

try {
  fs.statSync(__dirname + '/static/reporter.js')
} catch (_) {
  console.error('Reporter script missing. Run `make build` first.')
}

module.exports = function (opts) {
  if (!opts) opts = {};
  if ('number' == typeof opts) opts = { port: opts };
  if (!opts.browser) opts.browser = 'electron';
  if (!opts.input) opts.input = 'javascript';
  return runner(opts);
};

function runner (opts) {
  var empty = true;
  var input = through(function (chunk) {
    if (empty && chunk.toString().trim() != '') empty = false;
    this.queue(chunk);
  }, function () {
    if (empty) dpl.emit('error', new Error('javascript required'));
    this.queue(null);
  });
  var bundle = enstore();
  input.pipe(bundle.createWriteStream());
  var output = through();
  var dpl = duplex(input, output);

  var mockHandler = opts.mock && require(path.resolve('./', opts.mock))

  var server = http.createServer(function (req, res) {
    var path = url.parse(req.url).pathname;
    
    if (opts.input === 'javascript') {
      if (/^\/bundle\.js/.test(path)) {
        res.setHeader('content-type', 'application/javascript');
        res.setHeader('cache-control', 'no-cache');
        bundle.createReadStream().pipe(res);
        return;
      }

      if (path == '/') {
        fs.createReadStream(__dirname + '/static/index.html').pipe(res);
        return;
      }
    } else if (opts.input === 'html') {
      if (path == '/') {
        bundle.createReadStream().pipe(injectScript(['/reporter.js'])).pipe(res);
        return;
      }
    }

    if (path == '/xws') {
      req.pipe(xws(function (stream) {
        stream.pipe(output);
      }));
      return req.on('end', res.end.bind(res));
    }
    if (path == '/reporter.js') {
      res.setHeader('content-type', 'application/javascript');
      fs.createReadStream(__dirname + '/static/reporter.js').pipe(res);
      return;
    }
    if (opts.static) {
      ecstatic({ root: opts.static })(req, res);
      return;
    }
    if (mockHandler && '/mock' === path.substr(0,5)){
        return mockHandler(req, res);
    }

    res.end('not supported');
  });
  destroyable(server);

  var browser;

  if (opts.port) {
    server.listen(opts.port);
  } else {
    server.listen(function () {
      var address = server.address();
      if (!address) return; // already closed
      var port = address.port;

      launch(extend(opts, {
        loc: 'http://localhost:' + port + (opts.queryParams ? '?' + opts.queryParams : ''),
        name: opts.browser,
        bundle: bundle
      }), function(err, _browser){
        if (err) return dpl.emit('error', err);
        browser = _browser;

        // electron
        if (browser.pipe) {
          browser.setEncoding('utf8');
          browser.pipe(output);
        }

        browser.on('exit', function (code, signal) {
          // try { server.destroy() } catch (e) {}
          // dpl.emit('exit', code, signal);
        });
      });
    });
  }

  dpl.stop = function () {
    try { server.destroy(); } catch (e) {}
    if (browser) browser.kill();
  };

  return dpl;
}
