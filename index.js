//TODO: Just use mongodb-native instead of mongoskin?

//Dependencies
var fs       = require('fs'),
    mongo    = require('mongoskin'),
    ObjectID = require('mongoskin/node_modules/mongodb/lib/mongodb/bson/bson').ObjectID;


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
    
    //Reference to collections that have been emptied; to prevent deleting new data when loading from directory
    this.clearedCollections = [];
    
    //Connect
    this.db = mongo.db(host + ':' + port + '/' + dbName);
};

    

/**
 * Clears a collection and inserts the given data as new documents
 *
 * @param {Mixed}       The data to load. This parameter accepts either:
 *                          String: Path to a file or directory to load
 *                          Object: Object literal in the form described in docs
 * @param {Function}    Callback(err)
 */
Loader.prototype.load = function(data, callback) {
    var self = this;
    
    if (typeof data == 'object') {

        self.loadObject(data, callback);

    } else if (typeof data == 'string') {

        //Get the absolute dir path if a relative path was given
        if (data.substr(0, 1) !== '/') {
            var parentPath = module.parent.filename.split('/');
            parentPath.pop();
            data = parentPath.join('/') + '/' + data;
        }

        //Determine if data is pointing to a file or directory
        fs.stat(data, function(err, stats) {
            if (err) throw err;

            if (stats.isDirectory()) {
                self.loadDir(data, callback);
            } else { //File
                self.loadFile(data, callback);
            }
        });

    } else { //Unsupported type

        callback(new Error('Data must be an object, array or string (file or dir path)'));

    }
}

    
/**
 * Clears a collection and inserts the given data as new documents
 *
 * @param {String}      The name of the collection e.g. users, posts etc.
 * @param {Object}      The data to insert, as an array or object. E.g.:
 *                          { user1: {name: 'Alex'}, user2: {name: 'Bob'} }
 *                      or:
 *                          [ {name: 'Alex'}, {name:'Bob'} ]
 * @param {Function}    Optional callback(err)
 */
Loader.prototype.insertCollection = function(collectionName, data, callback) {
    callback = callback || function() {};
    
    var self = this;
    
    var collection = this.db.collection(collectionName);
    
    function doInsert() {
        //Convert object to array
        var items = [];
        if (Array.isArray(data)) {
            items = data;
        } else {
            for (var i in data) {
                items.push(data[i]);
            }
        }

        //Insert fixtures
        collection.insert(items, callback);
    }
    
    //Clear collection if first time
    if (this.clearedCollections.indexOf(collectionName) === -1) {
        //Have to mark it as cleared before running remove because it's async
        self.clearedCollections.push(collectionName);
        
        collection.remove({}, function(err) {
            if (err) return callback(err);

            doInsert();
        });
    } else {
        doInsert();
    }    
}


/**
 * Loads fixtures from object data
 * 
 * @param {Object}      The data to load, keyed by the Mongoose model name e.g.:
 *                          { users: [{name: 'Alex'}, {name: 'Bob'}] }
 * @param {Function}    Optional callback(err)
 */
Loader.prototype.loadObject = function(data, callback) {
    callback = callback || function() {};
    
    //Counters for managing callbacks
    var total = 0, 
        done = 0;
    
    //Go through each model's data
    for (var collectionName in data) {
        total++;
        
        this.insertCollection(collectionName, data[collectionName], function(err) {
            if (err) return callback(err);
            
            done++;
            if (done === total) callback();
        });
    }
}


/**
 * Loads fixtures from one file
 * 
 * @param {String}      The full path to the file to load
 * @param {Function}    Optional callback(err)
 */
Loader.prototype.loadFile = function(file, callback) { 
    callback = callback || function() {};
    
    if (file.substr(0, 1) !== '/') {
        var parentPath = module.parent.filename.split('/');
        parentPath.pop();
        file = parentPath.join('/') + '/' + file;
    }
    
    this.load(require(file), callback);
}


/**
 * Loads fixtures from all files in a directory
 * 
 * TODO: Add callback option
 * 
 * @param {String}      The directory path to load e.g. 'data/fixtures' or '../data'
 * @param {Function}    Optional callback(err)
 */
Loader.prototype.loadDir = function(dir, callback) {
    callback = callback || function() {};
    
    var self = this;
    
    //Get the absolute dir path if a relative path was given
    if (dir.substr(0, 1) !== '/') {
        var parentPath = module.parent.filename.split('/');
        parentPath.pop();
        dir = parentPath.join('/') + '/' + dir;
    }
    
    //Counters for managing callbacks
    var total = 0,
        done = 0;
    
    //Load each file in directory
    fs.readdir(dir, function(err, files){
        if (err) return callback(err);
        
        total = files.length;
        
        files.forEach(function(file) {
            self.loadFile(dir + '/' + file, function(err) {
                if (err) return callback(err);
                
                done++;
                if (total === done) callback();
            });
        });
    });
};
