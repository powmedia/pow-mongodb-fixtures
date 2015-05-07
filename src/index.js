'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var url = require('url');
var _ = require('lodash');
var mongo = require('mongodb');
var Promise = require('bluebird');

var ObjectID = mongo.ObjectID;
var basePath = path.dirname(module.parent.filename);

Promise.promisifyAll(fs);
Promise.promisifyAll(mongo);


/**
 * Get data from one file as an object
 *
 * @param {String} file The full path to the file to load
 *
 * @private
 */
function _fileToObject(file) {
    file = path.resolve(basePath, file);
    return require(file);
}


/**
 * Get and compile data from all files in a directory, as an object
 *
 * @param {String} dir The directory path to load e.g. 'data/fixtures' or '../data'
 *
 * @private
 */
function _directoryToObject(dir) {
    // Resolve relative paths if necessary.
    dir = path.resolve(basePath, dir);
    var collections = {};

    return fs
        .readdirAsync(dir)
        .map(function(file) {
            var path = dir + '/' + file;
            return fs
                .statAsync(path)
                .then(function(stats) {
                    return stats.isDirectory() ? {} : _fileToObject(path);
                });
        })
        .each(function(fileObject) {
            _.forEach(fileObject, function(docs, name) {
                //Convert objects to array
                if (_.isObject(docs)) {
                    docs = _.values(docs);
                }

                //Create array for collection if it doesn't exist yet
                if (!collections[name]) {
                    collections[name] = [];
                }

                //Add docs to collection
                collections[name] = collections[name].concat(docs);
            });
        })
        .return(collections); // TODO: verify
}


/**
 * Determine the type of fixtures being passed in (object, array, file, directory) and return
 * an object keyed by collection name.
 *
 * @param {Object|String} fixtures Fixture data (object, filename or dirname)
 * @return {Promise<Object[]>}
 *
 * @private
 */
var fixturesLoader = Promise.method(function(fixtures) {
    if (typeof fixtures === 'object') {
        return fixtures;
    }

    //As it's not an object, it should now be a file or directory path (string)
    if (typeof fixtures !== 'string') {
        throw new Error('Data must be an object, array or string (file or dir path)');
    }

    // Resolve relative paths if necessary.
    fixtures = path.resolve(basePath, fixtures);

    //Determine if fixtures is pointing to a file or directory
    return fs
        .statAsync(fixtures)
        .then(function(stats) {
            if (stats.isDirectory()) {
                return _directoryToObject(fixtures);
            } else {
                return _fileToObject(fixtures);
            }
        });
});


/**
 * Loader constructor
 *
 * @param {String} dbOrUri Database name or connection URI
 * @param {Object} [options] Connection options
 * @param {String} [options.host='localhost']
 * @param {Number} [options.port=27017]
 * @param {String} [options.user]
 * @param {String} [options.pass]
 * @param {Boolean} [options.safe=false]
 */
function Loader(dbOrUri, options) {
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
}


/**
 * Connects to the database and returns the client.
 * If a connection has already been established it is used.
 *
 * @returns {Promise<Object>} Promise of database
 *
 * @private
 */
Loader.prototype._connect = function() {
    if (this.client) {
        return this.client;
    }

    var options = this.options;
    var db = new mongo.Db(
        options.db,
        new mongo.Server(options.host, options.port, {}),
        {safe: options.safe}
    );

    this.client = db.openAsync()
        .then(function(db) {
            if (!options.user) {
                return db;
            }

            return db.authenticateAsync(options.user, options.pass).return(db);
        });

    return this.client;
};


/**
 * Inserts the given data (object or array) as new documents
 *
 * @param {Object} data
 * @return {Promise<null>}
 *
 * @private
 */
Loader.prototype._loadData = function(data) {
    var self = this;

    var collectionNames = _.keys(data);
    var connection = this._connect();

    return Promise.each(collectionNames, function(collectionName) {
        var collection = connection.call('collectionAsync', collectionName);
        var collectionData = data[collectionName];

        var items;
        if (Array.isArray(collectionData)) {
            // TODO: is this necessary?
            items = collectionData.slice();
        } else {
            items = _.values(collectionData);
        }

        var modifiedItems = Promise.map(items, function(item) {
            return Promise.each(self.modifiers, function(modifier) {
                return modifier
                    .call(modifier, collectionName, item)
                    .then(function(modifiedItem) {
                        item = modifiedItem;
                    });
            }).then(function() {
                return item;
            });
        });

        return modifiedItems
            .then(function(items) {
                return collection.call('insertAsync', items, {safe: true});
            });
    });
};


/**
 * Inserts data
 *
 * @param {String|Object} fixtures The data to load. This parameter accepts either:
 *      String: Path to a file or directory to load
 *      Object: Object literal in the form described in docs
 * @param {Function} [callback] Optional callback.
 * @return {Promise<null>}
 */
Loader.prototype.load = function(fixtures, callback) {
    return fixturesLoader(fixtures)
        .then(this._loadData.bind(this))
        .nodeify(callback);
};


/**
 * Add a modifier function.
 *
 * Modifier functions get called (in the order in which they were added) for each document, prior to it being loaded.
 * The result from each modifier is fed into the next modifier as its input, and so on until the final result which is
 * then inserted into the db.
 *
 * @param {Function} modifier The modifier function with signature (collectionName, document, callback).
 * @param {Boolean} [returnsPromise=false] If true, the function will not be promisified and signature
 * becomes (collectionName, document).
 */
Loader.prototype.addModifier = function(modifier, returnsPromise) {
    modifier = !!returnsPromise ? modifier : Promise.promisify(modifier);
    this.modifiers.push(modifier);
};


/**
 * loader.dropDatabase(cb) : Really drops the database
 *
 * @param {Function} [callback] Optional callback.
 * @return {Promise<null>}
 */
Loader.prototype.dropDatabase = function(callback) {
    return this
        ._connect()
        .call('dropDatabaseAsync')
        .return(null)
        .nodeify(callback);
};


/**
 * loader.clear(cb) : Clears all database collections
 *
 * loader.clear(collectionNames, cb) : Clears only the given collection(s)
 *
 * @param {String|Array} [collectionNames] Optional name or an array of collection names to clear
 * @param {Function} [callback] Optional callback.
 * @return {Promise<null>}
 */
Loader.prototype.clear = function(collectionNames, callback) {
    if (typeof collectionNames === 'function') {
        callback = collectionNames;
        collectionNames = null;
    }

    var getCollections = function(db) {
        if (typeof collectionNames === 'string') {
            collectionNames = [collectionNames];
        }

        assert(collectionNames == null || Array.isArray(collectionNames));

        return db
            .collectionsAsync()
            .filter(function(collection) {
                var collectionName = collection.s.name;
                var notSystemCollection = !_.startsWith(collectionName, 'system.');
                var inFilteredCollections = collectionNames == null ?
                    true : _.includes(collectionNames, collectionName);
                return notSystemCollection && inFilteredCollections;
            });
    };

    return this._connect()
        .then(getCollections)
        .each(function(collection) {
            return collection.removeAsync({}, {safe: true});
        })
        .return(null)
        .nodeify(callback);
};


/**
 * Clears all collections and loads fixtures
 *
 * @param {String|Object} fixtures The data to load. This parameter accepts either:
 *      String: Path to a file or directory to load
 *      Object: Object literal in the form described in docs
 * @param {Function} [callback] Optional callback.
 * @return {Promise<null>}
 */
Loader.prototype.clearAllAndLoad = function(fixtures, callback) {
    return this.clear()
        .then(this.load.bind(this, fixtures))
        .nodeify(callback);
};


/**
 * Clears only the collections that have documents to be inserted, then inserts data
 *
 * @param {String|Object} fixtures The data to load. This parameter accepts either:
 *      String: Path to a file or directory to load
 *      Object: Object literal in the form described in docs
 * @param {Function} [callback] Optional callback.
 * @return {Promise<null>}
 */
Loader.prototype.clearAndLoad = function(fixtures, callback) {
    return fixturesLoader(fixtures)
        .bind(this)
        .tap(function(data) {
            var collections = _.keys(data);
            //noinspection JSPotentiallyInvalidUsageOfThis
            return this.clear(collections);
        })
        .then(this._loadData.bind(this))
        .nodeify(callback);
};


/**
 * Close the connection to the DB
 *
 * @param {Function} [callback] Optional callback.
 */
Loader.prototype.close = function(callback) {
    if (!this.client) {
        throw new Error('No connection found!');
    }

    return this.client.call('closeAsync').nodeify(callback);
};


/**
 * Main method for connecting to the database and returning the fixture loader (Loader)
 *
 * @param {String} dbOrUri Database name or connection URI
 * @param {Object} [options] Connection options
 * @param {String} [options.host='localhost']
 * @param {Number} [options.port=27017]
 * @param {String} [options.user]
 * @param {String} [options.pass]
 * @param {Boolean} [options.safe=false]
 */
module.exports.connect = function(dbOrUri, options) {
    return new Loader(dbOrUri, options);
};


/**
 * Helper function that creates a MongoDB ObjectID given a HEX string
 * @param {String|ObjectID} [id] Optional hard-coded Object ID as string
 */
exports.createObjectId = function(id) {
    if (id instanceof ObjectID) {
        return id;
    } else if (typeof id === 'string' || id == null) {
        return new ObjectID(id);
    } else {
        throw new TypeError('Optional ID must be a string or an instance of ObjectID');
    }
};
