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
    
    //Track whether to clear collections
    _resetClearState.call(this);
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
    _resetClearState.call(this);
    
    _load.call(this, fixtures, cb);
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
        self.db.open(function(err, db) {
            if (err) return cb(err);
    		db.dropDatabase(cb);
    	});
    	
    	return;
    }
    
    //Convert single collection as string to array
    if (!_.isArray(collections)) collections = [collections];
    
    //Clear collections
    self.db.open(function(err, db) {
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
    
    _resetClearState.call(self);
    
    self.clear(function(err) {
	    if (err) return cb(err);

	    self.load(fixtures, function(err) {
	        cb();
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
    
    //Turn on clearing
    _resetClearState.call(self);
    self.clearCollectionsFirst = true;

	self.clear(collections, function(err) {
	    if (err) return cb(err);

	    self.load(fixtures, function(err) {
	        cb();
	    });
	});
};




//PRIVATE METHODS

var noop = function() {};


/**
 * Turns off clearing before inserting data
 */
var _resetClearState = function() {
    this.clearCollectionsFirst = false;
    this.clearedCollections = [];
};


/**
 * Inserts data
 *
 * @param {Mixed}       The data to load. This parameter accepts either:
 *                          String: Path to a file or directory to load
 *                          Object: Object literal in the form described in docs
 * @param {Function}    Callback(err)
 */
var _load = function(fixtures, cb) {
    var self = this;
    
    if (typeof fixtures == 'object') {

        _loadData.call(self, fixtures, cb);

    } else if (typeof fixtures == 'string') {

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
                _loadDir.call(self, fixtures, cb);
            } else { //File
                _loadFile.call(self, fixtures, cb);
            }
        });

    } else { //Unsupported type
        cb(new Error('Data must be an object, array or string (file or dir path)'));
    }
}


/**
 * Inserts the given data (object or array) as new documents
 *
 * @param {Object|Array} The data to load
 * @param {Function}     Callback(err)
 * @api private
 */
var _loadData = function(data, cb) {	
	var self = this,
	
	cb = cb || noop;
	
	var collectionNames = Object.keys(data);
	
	self.db.open(function (err, db) {
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
 * Loads fixtures from one file
 * 
 * @param {String}      The full path to the file to load
 * @param {Function}    Optional callback(err)
 * @api private
 */
var _loadFile = function(file, cb) { 
    cb = cb || noop;
    
    if (file.substr(0, 1) !== '/') {
        var parentPath = module.parent.filename.split('/');
        parentPath.pop();
        file = parentPath.join('/') + '/' + file;
    }
    
    this.load(require(file), cb);
}


/**
 * Loads fixtures from all files in a directory
 * 
 * @param {String}      The directory path to load e.g. 'data/fixtures' or '../data'
 * @param {Function}    Optional callback(err)
 * @api private
 */
var _loadDir = function(dir, cb) {
    cb = cb || noop;
    
    var self = this;
    
    //Get the absolute dir path if a relative path was given
    if (dir.substr(0, 1) !== '/') {
        var parentPath = module.parent.filename.split('/');
        parentPath.pop();
        dir = parentPath.join('/') + '/' + dir;
    }

    //Load each file in directory
    fs.readdir(dir, function(err, files){
        if (err) return cb(err);

		async.forEach(files, function(file, next) {
            _loadFile.call(self, dir + '/' + file, next);
		}, cb);
    });
};
