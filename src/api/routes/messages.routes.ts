import { messagesController } from 'api/controllers';
import express from 'express';

const router = express.Router();

router.post('/process-message', messagesController.processMessagesHandler);
router.delete('/delete-texts', messagesController.deleteTextsHandler);

export default router;
