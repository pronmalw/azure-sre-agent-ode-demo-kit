import request from 'supertest';
import { createApp } from '../../src/api/src/app';
import { getChaosService } from '../../src/api/src/services/chaos.service';
import { getTelemetryService } from '../../src/api/src/services/telemetry.service';

export const createTestClient = () => {
  getChaosService().reset();
  getTelemetryService().reset();
  return request(createApp());
};
