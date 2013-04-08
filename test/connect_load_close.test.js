var fixtures = require('../src/index.js'),
    dbName = 'pow-mongodb-fixtures-test';

exports['closeDb'] = function(test) {
	var db = fixtures.connect(dbName);
	db.load({}, function(){
		db.close(function() {
			test.done();
		});
	});
};
