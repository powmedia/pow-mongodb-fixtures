//Dependencies
var fs       = require('fs'),
    mongo    = require('mongodb'),
    ObjectID = require('mongodb/lib/mongodb/bson/bson').ObjectID,
  	async	 = require('async'),
  	_		 = require('underscore');


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
 * @param {String}  Database name
 * @param {Object}  Connection options: host ('localhost'), port (27017)
 */
exports.connect = function(dbName, options) {
    return new Loader(dbName, options);
}



/**
 * Loader constructor
 * 
 * @param {String}  Database name
 * @param {Object}  Connection options: host ('localhost'), port (27017)
 */
var Loader = exports.Loader = function(dbName, options) {
    options = options || {};
    
    var host = options.host || 'localhost',
        port = options.port || 27017;
    
    //Connect
    this.db = new mongo.Db(dbName, new mongo.Server(host, port, {}));
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
 * loader.clear(cb) : Clears (drops) the entire database
 *
 * loader.clear(collections, cb) : Clears only the given collection(s)
 *
 * @param {String|Array}    Optional. Name of collection to clear or an array of collection names
 * @param {Function}        Callback(err)
 */
Loader.prototype.clear = function(collections, cb) {
    //Normalise arguments
    if (arguments.length == 1) { //cb
      cb = collections;
      collections = null;
    }
    
    var self = this;
    
    //Drop DB
    if (!collections) {
      _connect(self, function(err, db) {
        if (err) return cb(err);
            
    		db.dropDatabase(cb);
    	});
    	
    	return;
    }
    
    //Convert single collection as string to array
    if (!_.isArray(collections)) collections = [collections];
    
    //Clear collections
    _connect(self, function(err, db) {
        if (err) return cb(err);
        
        async.forEach(collections, function(collection, cb) {
            db.dropCollection(collection, function(err) {
                if (err && err.message != 'ns not found') return cb(err);
                
                cb();
            });
        }, cb);
    });
};


/**
 * Drops the database and inserts data
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
  
  loader.db.open(function(err, client) {
    if (err) return cb(err);
    
    loader.client = client;
    cb(null, client);
  });
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
		
		async.forEach(collectionNames, function(collectionName, next) {
			var collectionData = data[collectionName];
			
			//Convert object to array
			var items;
			if (Array.isArray(collectionData)) {
				items = collectionData.slice();
			} else {
				items = _.values(collectionData);
			}
			
			db.collection(collectionName, function(err, collection) {
				if (err) return next(err);

				collection.insert(items, { safe: true }, next);
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

    //Get the absolute dir path if a relative path was given
    if (fixtures.substr(0, 1) !== '/') {
        var parentPath = module.parent.filename.split('/');
        parentPath.pop();
        fixtures = parentPath.join('/') + '/' + fixtures;
    }

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
    
    if (file.substr(0, 1) !== '/') {
        var parentPath = module.parent.filename.split('/');
        parentPath.pop();
        file = parentPath.join('/') + '/' + file;
    }

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
    
    //Get the absolute dir path if a relative path was given
    if (dir.substr(0, 1) !== '/') {
        var parentPath = module.parent.filename.split('/');
        parentPath.pop();
        dir = parentPath.join('/') + '/' + dir;
    }
    
    async.waterfall([
        function readDir(cb) {
            fs.readdir(dir, cb)
        },
        
        function filesToObjects(files, cb) {
            async.map(files, function processFile(file, cb) {
                var path = dir + '/' + file;
                _fileToObject(path, cb);
            }, cb);
        },
        
        function combineObjects(results, cb) {
            //console.log('RESULTS', results);
            
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
