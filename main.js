var restify = require('restify')
    , Datastore = require('nedb')
    , db = new Datastore({ filename: 'data/users.nedb', autoload: true })
    , winston = require('winston')
    , crypto = require('crypto');

// Setup logging.
var log = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({ level: 'debug' }),
    new (winston.transports.File)({ filename: 'log.log', level: 'debug' })
  ]
});

// Configure the database.
db.ensureIndex({ fieldName: 'email', unique: true }, function (err) {
  if(err){
    log.error("ensureIndex: %j", err )
  }
});

function register_account(req, res, next) {
  // TODO: Maybe should check email exists before doing this, thought its sitll caught by the DBs index.
  var d = crypto.createHash('sha1'); // TODO: Make sure this is 'random'
  var insert_data = {};
  // TODO: Check correct email 
  insert_data['email'] = req.params.email;
  insert_data['activation_key'] = d.digest('hex');

  db.insert(insert_data, function (err, data) {
    if(err && err.errorType == "uniqueViolated")
    {
      res.status(400);
      log.verbose("Attempted to create an existing account: '%s'.", req.params.email);
      res.send('This email address has been registered.');
    }else if(err){
      res.status(500);
      log.error("register_account.insert(): ", err);
      res.send('There has been a problem.');
    }else if(!err && data){
      res.status(201);
      log.info("Account '%s' created.", data.email);
      res.send('Acount created, check your inbox.');
    }
  });

  // TODO: Check for public GPG Key
  // TODO: Send verification email

  next();
}

function activate_account(req, res, next) {
  db.update({ activation_key: req.params.activation_key }, { $unset: { activation_key: true } }, {}, function (err, numReplaced, newDoc) {
    if(numReplaced != 1){
        res.status(500);
        log.verbose("Unable to activate account with ID: '%s'.", req.params.activation_key);
        res.send('Unable to activate account.');
    }else if(err){
      res.status(500);
      log.error("activate_account.update(): ", err);
      res.send('Unable to activate account.');
    }else{
      // TODO: Run userspace bash script.
      res.status(201);
      log.info('User verified email.');
      res.send('Account activated.');
    }
  });
  next();
}


var server = restify.createServer();

server.get('/register/:email', register_account);
server.head('/register/:email', register_account);

server.get('/activate/:activation_key', activate_account);
server.head('/activate/:activation_key', activate_account);

server.listen(8080, function() {
  log.info('Server started on %s', server.url);
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

// TODO: Handle signals.