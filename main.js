var restify = require('restify')
    , Datastore = require('nedb')
    , db = new Datastore({ filename: 'data/users.nedb', autoload: true });

// Register an account
function register_account(req, res, next) {
  // Check email is free
  db.find({ email: req.params.email }, function (err, docs) { // TODO: Replace with count function.
    if(docs.length != 0) { 
      res.send('You have an account.');
      // Create an activation_key 
    } else {
      res.send('Creating new account.');
      db.insert(req.params, function (err, newDoc) { console.log(newDoc); });
      // Check for public GPG Key
      // Send verification email
    }
  });
  next();
}

// Account Activation
function activate_account(req, res, next) {
  // confirm verification ID from email
  db.find({ activation_key: req.params.activation_key }, function (err, docs) { // TODO: Replace with count function.
    if(docs.length == 1) { 
      res.send('Activating account: ' + docs.email);
    } else {
      res.send('Account not found.');
    }
    // Check for public GPG Key
    // Send verification email
  });
  // Configure User space
  next();
}


var server = restify.createServer();

server.get('/register/:email', register_account);
server.head('/register/:email', register_account);

server.get('/activate/:activation_key', activate_account);
server.head('/activate/:activation_key', activate_account);

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

