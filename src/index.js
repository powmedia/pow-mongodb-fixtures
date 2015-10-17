//Dependencies
var fs       = require('fs'),
    url      = require('url'),
    path     = require('path'),
    mongo    = require('mongodb'),
    ObjectID = mongo.ObjectId,
    async    = require('async'),
    _        = require('underscore'),
    basePath = path.dirname(module.parent.filename);


/**
 * Helper function that creates a MongoDB ObjectID given a hex string
 * @param {String|ObjectId}  Optional hard-coded Object ID as string
 */
exports.createObjectId = function(id) {
  if (!id) return new ObjectID();

  //Allow cloning ObjectIDs
  if (id.constructor.name == 'ObjectID') id = id.toString();

  return new ObjectID(id);
};



/**
 * Main method for connecting to the database and returning the fixture loader (Loader)
 *
 * @param {String} dbOrUri    Database name or connection URI
 * @param {Object} [options]  Connection options: host ('localhost'), port (27017)
 */
exports.connect = function(db, options) {
  return new Loader(db, options);
}



/**
 * Loader constructor
 *
 * @param {String} dbOrUri          Database name or connection URI
 * @param {Object} [options]        Connection options
 * @param {String} [options.host]   Default: 'localhost'
 * @param {Number} [options.port]   Default: 27017
 * @param {String} [options.user]   Username
 * @param {String} [options.pass]   Password
 * @param {Boolean} [options.safe]  Default: false
 */
var Loader = exports.Loader = function(dbOrUri, options) {
  //Try parsing uri
  var parts = url.parse(dbOrUri);

  //Using connection URI
  if (parts.protocol) {
    options = _.extend({
      db: parts.path.replace('/', ''),
      host: parts.hostname,
      port: parseInt(parts.port, 10),
      user: parts.auth ? parts.auth.split(':')[0] : null,
      pass: parts.auth ? parts.auth.split(':')[1] : null,
      safe: true
    }, options);
  }

  //Using DB name
  else {
    options = _.extend({
      db: dbOrUri,
      host: 'localhost',
      port: 27017,
      user: null,
      pass: null,
      safe: true
    }, options);
  }
  
  this.options = options;
  this.modifiers = [];
};


/**
 * Inserts data
 *
 * @param {Mixed}       The data to load. This parameter accepts either:
 *                          String: Path to a file or directory to load
 *                          Object: Object literal in the form described in docs
 * @param {Function}    Callback(err)
 */
Loader.prototype.load = function(fixtures, cb) {
  var self = this;

  _mixedToObject(fixtures, function(err, data) {
    if (err) return cb(err);

    _loadData(self, data, cb);
  });
};



/**
 * Add a modifier function.
 *
 * Modifier functions get called (in the order in which they were added) for each document, prior to it being loaded.
 * The result from each modifier is fed into the next modifier as its input, and so on until the final result which is
 * then inserted into the db.
 *
 * @param {Function} cb        The modifier callback function with signature (collectionName, document, callback).
 */
Loader.prototype.addModifier = function(cb) {
  this.modifiers.push(cb);
};



/**
 * loader.clear(cb) : Clears all collections
 *
 * loader.clear(collectionNames, cb) : Clears only the given collection(s)
 *
 * @param {String|Array}    Optional. Name of collection to clear or an array of collection names
 * @param {Function}        Callback(err)
 */
Loader.prototype.clear = function(collectionNames, cb) {
  //Normalise arguments
  if (arguments.length == 1) { //cb
    cb = collectionNames;
    collectionNames = null;
  }

  var self = this;

  var results = {};

  async.series([
    function connect(cb) {
      _connect(self, function(err, db) {
        if (err) return cb(err);

        results.db = db;
        cb();
      })
    },

    function getCollectionNames(cb) {
      //If collectionNames not passed, clear all of them
      if (!collectionNames) {
        results.db.listCollections().toArray(function(err, names) {
          if (err) return cb(err);

          //Get the real collection names
          names = _.map(names, function(nameObj) {
            var fullName = nameObj.name,
                parts = fullName.split('.');

            //Skip system collections
            if (parts[0] == 'system' || parts[0] == 'local') return;

            return parts.join('.');
          });

          results.collectionNames = _.compact(names);

          cb();
        })
      } else {
        //Convert single collection as string to array
        if (!_.isArray(collectionNames)) collectionNames = [collectionNames];

        async.map(collectionNames, function (collectionName, cbForEachCollection) {
          results.db.listCollections({ name: collectionName }).toArray(cbForEachCollection);
        }, function (err, result) {
          if (err) { return cb(err); }

          result = _.flatten(result);

          if (_.isEmpty(result)) {
            results.collectionNames = null;
            return cb();
          }

          results.collectionNames = collectionNames;
          cb();
        });
      }
    },

    function clearCollections() {
      if (results.collectionNames) {
        async.forEach(results.collectionNames, function(name, cb) {
          var collection = results.db.collection(name);

          collection.drop(cb);
        }, cb);
      } else { cb(); }
    }
  ], cb)
};


/**
 * Clears all collections and inserts data
 *
 * @param {Mixed}           The data to load. This parameter accepts either:
 *                              String: Path to a file or directory to load
 *                              Object: Object literal in the form described in docs
 * @param {Function}        Callback(err)
 */
Loader.prototype.clearAllAndLoad = function(fixtures, cb) {
  var self = this;

  self.clear(function(err) {
    if (err) return cb(err);

    self.load(fixtures, function(err) {
      cb(err);
    });
	});
};


/**
 * Clears only the collections that have documents to be inserted, then inserts data
 *
 * @param {Mixed}           The data to load. This parameter accepts either:
 *                              String: Path to a file or directory to load
 *                              Object: Object literal in the form described in docs
 * @param {Function}        Callback(err)
 */
Loader.prototype.clearAndLoad = function(fixtures, cb) {
  var self = this;

  _mixedToObject(fixtures, function(err, objData) {
    if (err) return cb(err);

    var collections = Object.keys(objData);

    self.clear(collections, function(err) {
      if (err) return cb(err);

      _loadData(self, objData, cb);
  	});
  });
};

/**
 * Close the connection to the DB
 *
 * @param {Function} Callback(err)
 */
Loader.prototype.close = function(cb) {
  var self = this;

  _close(self, function (err) {
    if (err) return cb(err);
    cb();
  });
};


//PRIVATE METHODS

var noop = function() {};

/**
 * Connects to the database and returns the client. If a connection has already been established it is used.
 *
 * @param {Loader}       The configured loader
 * @param {Function}     Callback(err, client)
 */
var _connect = function(loader, cb) {
  if (loader.client) return cb(null, loader.client);

  var options = loader.options;

  var db = new mongo.Db(options.db, new mongo.Server(options.host, options.port, {}), {safe: options.safe});

  db.open(function(err, db) {
    if (err) return cb(err);

    loader.client = db;

    //Authenticate if required
    if (!options.user) return cb(null, db);

    db.authenticate(options.user, options.pass, function(err, result) {
      if (err) return cb(err);

      cb(null, db);
    });
  });
};

/**
 * Close the connection to the database, if it exists
 *
 * @param {Function} Callback(err)
 */

var _close = function(loader, cb) {
  var db = loader.client;
  if (db) {
    db.close(function (err, results) {
      if (err) return cb(err);
      cb(null);
    });
  } else {
    cb(new Error("No connection found!"));
  }
};

/**
 * Inserts the given data (object or array) as new documents
 *
 * @param {Loader}       The configured loader
 * @param {Object|Array} The data to load
 * @param {Function}     Callback(err)
 * @api private
 */
var _loadData = function(loader, data, cb) {
	cb = cb || noop;

	var collectionNames = Object.keys(data);

	_connect(loader, function(err, db) {
		if (err) return cb(err);

		async.forEach(collectionNames, function(collectionName, cbForEachCollection) {
			var collectionData = data[collectionName];

      //Convert object to array
      var items;
      if (Array.isArray(collectionData)) {
        items = collectionData.slice();
      } else {
        items = _.values(collectionData);
      }

      var modifiedItems = [];

      async.forEach(items, function(item, cbForEachItem) {
        // apply modifiers
        async.forEach(loader.modifiers, function(modifier, cbForEachModifier) {
          modifier.call(modifier, collectionName, item, function(err, modifiedDoc) {
            if (err) return cbForEachModifier(err);

            item = modifiedDoc;

            cbForEachModifier();
          });
        }, function(err) {
          if (err) return cbForEachItem(err);

          modifiedItems.push(item);

          cbForEachItem();
        });
      }, function(err) {
        if (err) return cbForEachCollection(err);

        db.collection(collectionName, function(err, collection) {
          if (err) return cbForEachCollection(err);

          collection.insertMany(modifiedItems, { safe: true }, cbForEachCollection);
        });
      });
		}, cb);
	});
};


/**
 * Determine the type of fixtures being passed in (object, array, file, directory) and return
 * an object keyed by collection name.
 *
 * @param {Object|String}       Fixture data (object, filename or dirname)
 * @param {Function}            Optional callback(err, data)
 * @api private
 */
var _mixedToObject = function(fixtures, cb) {
  if (typeof fixtures == 'object') return cb(null, fixtures);

  //As it's not an object, it should now be a file or directory path (string)
  if (typeof fixtures != 'string') {
    return cb(new Error('Data must be an object, array or string (file or dir path)'));
  }

  // Resolve relative paths if necessary.
  fixtures = path.resolve(basePath, fixtures);

  //Determine if fixtures is pointing to a file or directory
  fs.stat(fixtures, function(err, stats) {
    if (err) return cb(err);

    if (stats.isDirectory()) {
      _dirToObject(fixtures, cb);
    } else { //File
      _fileToObject(fixtures, cb);
    }
  });
}


/**
 * Get data from one file as an object
 *
 * @param {String}      The full path to the file to load
 * @param {Function}    Optional callback(err, data)
 * @api private
 */
var _fileToObject = function(file, cb) {
  cb = cb || noop;

  // Resolve relative paths if necessary.
  file = path.resolve(basePath, file);

  var data = require(file);

  cb(null, data);
}


/**
 * Get and compile data from all files in a directory, as an object
 *
 * @param {String}      The directory path to load e.g. 'data/fixtures' or '../data'
 * @param {Function}    Optional callback(err)
 * @api private
 */
var _dirToObject = function(dir, cb) {
  cb = cb || noop;

  // Resolve relative paths if necessary.
  dir = path.resolve(basePath, dir);

  async.waterfall([
    function readDir(cb) {
      fs.readdir(dir, cb)
    },

    function filesToObjects(files, cb) {
      async.map(files, function processFile(file, cb) {
        var path = dir + '/' + file;

        // Determine if it's a file or directory
        fs.stat(path, function(err, stats) {
          if (err) return cb(err);

          if (stats.isDirectory()) {
            cb(null, {});
          } else { //File
            _fileToObject(path, cb);
          }
        });
      }, cb);
    },

    function combineObjects(results, cb) {
      //Where all combined data will be kept, keyed by collection name
      var collections = {};

      results.forEach(function(fileObj) {
        _.each(fileObj, function(docs, name) {
          //Convert objects to array
          if (_.isObject(docs)) {
            docs = _.values(docs);
          }

          //Create array for collection if it doesn't exist yet
          if (!collections[name]) collections[name] = [];

          //Add docs to collection
          collections[name] = collections[name].concat(docs);
        });
      });

      cb(null, collections)
    }
  ], function(err, combinedData) {
    if (err) return cb(err);

    cb(null, combinedData);
  });
};


/**
 * Builds the full connection URI
 *
 * @param {Object} options
 *
 * @return {String}
 */
var _buildConnectionUri = function(options) {
  var parts = ['mongodb://'];

  if (options.user) parts.push(options.user);

  if (options.pass) {
    parts.push(':');
    parts.push(options.pass);
  }

  if (options.user) {
    parts.push('@');
  }

  parts.push(options.host);
  parts.push(':');
  parts.push(options.port);
  parts.push('/');
  parts.push(options.db);

  return parts.join('');
}