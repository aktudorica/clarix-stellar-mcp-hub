import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  ChevronRight,
  Fingerprint,
  Search,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react';
import { catalogQuery } from '../lib/api';
import { ErrorState, LoadingState } from '../components/feedback';
import { Button } from '../components/ui/button';

export function Marketplace() {
  const catalog = useQuery(catalogQuery);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All services');
  const services = catalog.data?.data ?? [];
  const categories = ['All services', ...new Set(services.map((service) => service.category))];
  const filtered = useMemo(
    () =>
      services.filter(
        (service) =>
          (category === 'All services' || service.category === category) &&
          `${service.name} ${service.description} ${service.provider.name}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [services, search, category],
  );

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">DISCOVER. CONNECT. BUILD.</span>
          <h1>
            Intelligence for your agents<span>.</span>
          </h1>
          <p>Discover focused services for the Stellar ecosystem.</p>
        </div>
        <span className="release-badge">
          <span /> Developer preview
        </span>
      </div>
      <section className="hero-panel" aria-label="About the platform">
        <div className="hero-copy">
          <span className="hero-kicker">
            <Sparkles size={14} /> THE AGENT ECONOMY, CONNECTED
          </span>
          <h2>
            From a question
            <br />
            to an on-chain answer.
          </h2>
          <p>
            Explore accounts and transactions with focused tools, saved reports and traceable
            Stellar data.
          </p>
          <a href="#services">
            Explore the service catalog <ArrowRight size={16} />
          </a>
        </div>
        <div className="flow-illustration" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="flow-node agent-node">
            <Workflow size={22} />
            <span>Your agent</span>
            <small>Discover & request</small>
          </div>
          <div className="flow-connector">
            <span />
            <ChevronRight size={16} />
            <span />
          </div>
          <div className="hub-node">
            <img src="/favicon.svg" alt="" />
            <span>Clarix Hub</span>
          </div>
          <div className="flow-connector">
            <span />
            <ChevronRight size={16} />
            <span />
          </div>
          <div className="flow-node stellar-node">
            <Braces size={22} />
            <span>StellarChain</span>
            <small>Intelligence services</small>
          </div>
          <div className="flow-caption">
            <span /> DESIGNED FOR MCP + X402
          </div>
        </div>
      </section>
      <section id="services" className="catalog-section">
        <div className="section-heading">
          <div>
            <h2>
              Service catalog <span className="count-badge">{services.length}</span>
            </h2>
            <p>Purpose-built tools. Clear capabilities.</p>
          </div>
          <div className="search-field">
            <Search size={17} />
            <label className="sr-only" htmlFor="service-search">
              Search services
            </label>
            <input
              id="service-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search services…"
            />
            {search && (
              <button aria-label="Clear search" onClick={() => setSearch('')}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="catalog-toolbar">
          <div className="filter-tabs" aria-label="Service categories">
            {categories.map((item) => (
              <button
                key={item}
                className={category === item ? 'active' : ''}
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <span className="catalog-caption">Provider: Clarix · StellarChain</span>
        </div>
        {catalog.isPending ? (
          <LoadingState />
        ) : catalog.isError ? (
          <ErrorState
            retry={() => {
              void catalog.refetch();
            }}
          />
        ) : (
          <div className="service-grid">
            {filtered.map((service) => (
              <article className="service-card" key={service.id}>
                <div className="card-top">
                  <div
                    className={`service-icon ${service.category === 'Accounts' ? 'purple' : 'orange'}`}
                  >
                    {service.category === 'Accounts' ? (
                      <Fingerprint size={25} />
                    ) : (
                      <Workflow size={25} />
                    )}
                  </div>
                  <span className="service-state">
                    {service.status === 'ACTIVE'
                      ? 'Available'
                      : service.status === 'PLANNED'
                        ? 'In development'
                        : 'Disabled'}
                  </span>
                </div>
                <div className="provider-label">
                  STELLARCHAIN{' '}
                  <span>
                    <Check size={9} />
                  </span>
                </div>
                <h3>{service.name}</h3>
                <p className="service-description">{service.description}</p>
                <div className="capability-tags">
                  {service.capabilities.map((capability) => (
                    <span key={capability}>{capability}</span>
                  ))}
                </div>
                <div className="card-bottom">
                  <span>
                    <span className="tiny-network-dot" /> Stellar Testnet
                  </span>
                  <Link to={`/services/${service.slug}`}>
                    View service <ArrowUpRight size={16} />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
        {!catalog.isPending && !catalog.isError && filtered.length === 0 && (
          <div className="feedback">
            <Search size={24} />
            <h2>No matching services</h2>
            <p>Try another search or category.</p>
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setCategory('All services');
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
      </section>
      <div className="foundation-note">
        <div className="note-icon">
          <Braces size={20} />
        </div>
        <div>
          <strong>Real Testnet data. Saved evidence.</strong>
          <p>
            Account and transaction analyses are available in the internal preview. Reports include
            source evidence and coverage limits. Connect Freighter and configure agent access in
            Integrations. Paid Testnet requests require separate setup.
          </p>
        </div>
        <Link to="/status">
          Check platform <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
