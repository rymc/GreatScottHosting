var restify = require('restify');

var Datastore = require('nedb')
  , db = new Datastore({ filename: 'data/users.nedb', autoload: true });

function respond(req, res, next) {
  res.send('hello ' + req.params.name + ' aged ' + req.params.age);
  db.insert(req.params, function (err, newDoc) { console.log(newDoc); });
  res.send('Inserted');
  next();
}

function list(req, res, next) {
  db.find({ }, function (err, docs) {
  	console.log(docs);
  });
  res.send('Listed');
  next();
}

var server = restify.createServer();
server.get('/hello/:name/:age/:email', respond);
server.head('/hello/:name/:age/:email', respond);

server.get('/list', list);
server.head('/list', list);

server.listen(8080, function() {
  console.log('%s listening at %s', server.name, server.url);
});

// Functions to parse-user input.

// Register an account
	// Check email is free
	// Check for public GPG Key
	// Send verification email

// Account Activation
	// confirm verification ID from email
	// Configure User space

// Add SSH Public Key

