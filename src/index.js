//Dependencies
var fs       = require('fs'),
    mongo    = require('mongodb'),
    ObjectID = require('mongodb/lib/mongodb/bson/bson').ObjectID,
	async	 = require('async'),
	_		 = require('underscore');


var noop = function() {};


/**
 * Main method for connecting to the database and returning the fixture loader (Loader)
 * 
 * @param {String}  Database name
 * @param {Object}  Connection options: host ('localhost'), port (27017)
 */
module.exports.connect = function(dbName, options) {
    return new Loader(dbName, options);
}



/**
 * Helper function that creates a MongoDB ObjectID given a hex string
 * @param {String}  Optional hard-coded Object ID as string
 */
module.exports.createObjectId = function(str) {
    if (str)
        return new ObjectID(str);
    else
        return new ObjectID();
};



/**
 * Loader constructor
 * 
 * @param {String}  Database name
 * @param {Object}  Connection options: host ('localhost'), port (27017)
 */
var Loader = function(dbName, options) {
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
    
    if (typeof fixtures == 'object') {

        self.loadData(fixtures, cb);

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
                self.loadDir(fixtures, cb);
            } else { //File
                self.loadFile(fixtures, cb);
            }
        });

    } else { //Unsupported type
        cb(new Error('Data must be an object, array or string (file or dir path)'));
    }
};


/**
 * Clears the database
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
 * Clears the database and inserts data
 *
 * @param {String|Array}    Optional. Name of collection to clear or an array of collection names
 * @param {Mixed}           The data to load. This parameter accepts either:
 *                              String: Path to a file or directory to load
 *                              Object: Object literal in the form described in docs
 * @param {Function}        Callback(err)
 */
Loader.prototype.clearAndLoad = function(collections, fixtures, cb) {
    if (arguments.length == 2) { //fixtures, cb
	    cb = fixtures;
	    fixtures = collections;
	    collections = null;
    }
    
	var self = this;

	self.clear(collections, function(err) {
	    if (err) return cb(err);

	    self.load(fixtures, function(err) {
	        cb();
	    });
	});
};


/**
 * Inserts the given data (object or array) as new documents
 *
 * @param {Object|Array} The data to load
 * @param {Function}     Callback(err)
 */
Loader.prototype.loadData = function(data, cb) {	
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
				items = _.map(collectionData, function(item) {
					return item;
				});
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
 */
Loader.prototype.loadFile = function(file, cb) { 
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
 * TODO: Add callback option
 * 
 * @param {String}      The directory path to load e.g. 'data/fixtures' or '../data'
 * @param {Function}    Optional callback(err)
 */
Loader.prototype.loadDir = function(dir, cb) {
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
            self.loadFile(dir + '/' + file, next);
		}, cb);
    });
};
