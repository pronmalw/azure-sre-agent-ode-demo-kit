import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Layout } from './components/Layout';
import { CartPage } from './pages/CartPage';
import { HomePage } from './pages/HomePage';
import { OpsControlPanel } from './pages/OpsControlPanel';
import { ProductsPage } from './pages/ProductsPage';
import { SreAgentPage } from './pages/SreAgentPage';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock('./utils/api', () => ({
  default: apiMock,
}));

describe('frontend pages', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    apiMock.put.mockReset();
    apiMock.get.mockResolvedValue({ data: [] });
    apiMock.post.mockResolvedValue({ data: {} });
    apiMock.put.mockResolvedValue({ data: {} });
    window.localStorage.clear();
  });

  it('HomePage renders without crash', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Welcome to Contoso Retail/i)).toBeInTheDocument();
  });

  it('ProductsPage renders loading state', () => {
    render(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Loading products/i)).toBeInTheDocument();
  });

  it('CartPage renders empty cart', () => {
    render(
      <MemoryRouter>
        <CartPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Your cart is empty/i)).toBeInTheDocument();
  });

  it('OpsControlPanel renders chaos toggles', () => {
    apiMock.get.mockResolvedValue({
      data: {
        chaosState: {
          hotPartition: false,
          metadataThrottling: false,
          multipleClients: false,
          highCpu: false,
          crossPartitionQuery: false,
          largeDocument: false,
          missingIndexing: false,
          pointReadMisuse: false,
          sqlSlowQuery: false,
          sqlConnectionPressure: false,
        },
        telemetrySnapshot: {
          latencyP50Ms: 0,
          latencyP99Ms: 0,
          cosmos429Count: 0,
          ruUsage: 0,
          serverSideLatencyMs: 12,
          hostCpuPercent: 15,
          checkoutSuccessRate: 1,
          recentDeploymentEvent: false,
          activeToggles: [],
          sqlQueryLatencyMs: 0,
          sqlErrorCount: 0,
          timestamp: new Date().toISOString(),
        },
        activeIncident: false,
        loadGenerator: { running: false, rps: 0 },
        timestamp: new Date().toISOString(),
      },
    });
    render(
      <MemoryRouter>
        <OpsControlPanel />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Azure SRE Agent — ODE Reduction Demo/i)).toBeInTheDocument();
    expect(screen.getByText(/hotPartition/i)).toBeInTheDocument();
  });

  it('SreAgentPage renders investigation button', () => {
    render(
      <MemoryRouter>
        <SreAgentPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /Run Investigation/i })).toBeInTheDocument();
  });

  it('Layout renders header with Contoso Retail brand', () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div>Child</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/Contoso Retail/i)[0]).toBeInTheDocument();
  });
});

