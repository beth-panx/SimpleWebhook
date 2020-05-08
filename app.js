require('dotenv').config({path: '.env'});
const crypto = require('crypto');
const sharedSecret = process.env.DEV_TOKEN;
const bufSecret = Buffer.from(sharedSecret, "base64");
const http = require('http');
const PORT = process.env.port || process.env.PORT || 3007;
const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const cosmosClient = new CosmosClient({ endpoint, key });

async function connectDb() {
	const { database } = await cosmosClient.databases.createIfNotExists({ id: "TESTTEST" });
	const { container } = await database.containers.createIfNotExists({ id: "TESTContainer" });

	return { database: database, container: container };
}

http.createServer(function(request, response) { 
	var payload = '';
	// Process the request
	request.on('data', function (data) {
		payload += data;
	});
	
	// Respond to the request
	request.on('end', async function() {
		try {
			// Retrieve authorization HMAC information
			var auth = this.headers['authorization'];
			// Calculate HMAC on the message we've received using the shared secret			
			var msgBuf = Buffer.from(payload, 'utf8');
			var msgHash = "HMAC " + crypto.createHmac('sha256', bufSecret).update(msgBuf).digest("base64");
			
			response.writeHead(200);
			if (msgHash === auth) {
				var searchVal = 'next question';
				var followupText = 'You have reach the end of the question queue. Yay! 🙌';
				var receivedMsg = JSON.parse(payload);
				var db = await connectDb();

				if (receivedMsg.text.toLowerCase().includes(searchVal)) {
					// Key word 'next question' detected. Dequeue question queue.
					// Get list of questions from cosmos db
					try {
						var { resources: questions } = await db.container.items.query("SELECT * from c WHERE c.status='unanswered'").fetchAll();
					} catch (err) {
						response.writeHead(400);
						return response.end("Error: " + err + "\n" + err.stack);
					}

					if (!questions || questions.length == 0) {
						var responseMsg = '{ "type": "message", "text": "' + followupText + '" }';
					} else {
						var currentQuestion = questions.shift();
						// mark question as answered
						try{
							currentQuestion.status = "answered";
							const { resource: answeredQuestion } = await db.container.item(currentQuestion.id).replace(currentQuestion);
						} catch (err) {
						}

						if (currentQuestion) {
							// replace @mention botname
							var currentQuestionText = currentQuestion.message.text.replace(/<at[^>]*>(.*?)<\/at> *(&nbsp;)*/, '');
							var numberQuestionLeft = questions.length;

							if (numberQuestionLeft > 0) {
								followupText = 'You have ' + numberQuestionLeft + ' more questions in the queue.';
							}
							var responseMsg = '{"type": "message", "text": "🤓From: @' + currentQuestion.message.from.name + '\n\n🦒Question: ' + currentQuestionText + '\n\n👀' + followupText + '"}';
							
						} else {
							var responseMsg = '{ "type": "message", "text": "' + followupText + '" }';
						}
					}
				} else {
					try {
						// add message to cosmos db
						await db.container.items.create({message: receivedMsg, status: "unanswered"});
					} catch (err) {
						response.writeHead(400);
						return response.end("Error: " + err + "\n" + err.stack);
					}
				
					var responseMsg = '{ "type": "message", "text": "Your request has been added to a queue. We will notify you when it is your turn to speak. 😎" }';	
				}
			} else {
				var responseMsg = '{ "type": "message", "text": "Error: message sender cannot be authenticated." }';
			}
			response.write(responseMsg);
			response.end();
		}
		catch (err) {
			response.writeHead(400);
			return response.end("Error: " + err + "\n" + err.stack);
		}
	});
		
}).listen(PORT);

console.log('Listening on port %s', PORT);
