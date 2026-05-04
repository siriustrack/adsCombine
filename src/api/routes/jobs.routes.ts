import { jobsController } from 'api/controllers';
import express from 'express';

const router = express.Router();

router.post('/process-message', jobsController.createProcessMessageJobHandler);
router.get('/:jobId/status', jobsController.getJobStatusHandler);
router.get('/:jobId/result', jobsController.getJobResultHandler);

export default router;
