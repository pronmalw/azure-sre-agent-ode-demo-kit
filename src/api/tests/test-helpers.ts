import request from 'supertest';
import { createApp } from '../src/app';
import { getChaosService } from '../src/services/chaos.service';
import { getTelemetryService } from '../src/services/telemetry.service';

export const createTestClient = () => {
  getChaosService().reset();
  getTelemetryService().reset();
  return request(createApp());
};

