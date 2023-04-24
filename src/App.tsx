import { useEffect, useState } from 'react';
import './App.scss';
import { PullRequest, Release } from './types';
import { GH_PARITY } from './consts';
import { useLocalStorage } from './useLocalStorage';

function releaseLink(tag: string): string {
  return `${GH_PARITY}/polkadot/releases/tag/${tag}`
}

function tagLink(tag: string): string {
  return `${GH_PARITY}/polkadot/tree/${tag}`
}

export const App = (): JSX.Element => {
  const [releases, setReleases] = useState<Release[]>([]);
  const [filteredReleases, setFilteredReleases] = useState<Release[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const [promptHeaders, setPromptHeaders] = useLocalStorage("polkadot_releases_gh_token");
  const [headers, setHeaders] = useState({})

  if (!promptHeaders && !(import.meta.env.VITE_APP_GH_API && import.meta.env.DEV)) {
    let promptResponse = prompt('give me a gh token');
    setPromptHeaders(promptResponse || '');
  }

  useEffect(() => {
    console.log('import.meta.env.VITE_APP_GH_API && import.meta.env.DEV', import.meta.env.VITE_APP_GH_API, import.meta.env.DEV)
    if (import.meta.env.VITE_APP_GH_API && import.meta.env.DEV) {
      setHeaders({ Authorization: `Bearer ${import.meta.env.VITE_APP_GH_API}` });
    } else {
      setHeaders({ Authorization: `Bearer ${promptHeaders}` })
    }
  }, [promptHeaders]);

  const getPrsBetween = async (repo: string, from: string, to: string): Promise<PullRequest[]> => {
    const commitsUrl = `https://api.github.com/repos/paritytech/${repo}/compare/${from}...${to}`;
    const commitsResponse = await fetch(commitsUrl, { headers });
    const diff = await commitsResponse.json();
    // @ts-ignore
    return diff.commits.map((c) => {
      return {
        author: c.author ? c.author.login : "UNKNOWN",
        id: c.commit.message.id,
        title: c.commit.message.replace(/\n/g, ""),
        repo
      }
    });
  };

  const getVersionFromCargo = async (repo: string, commitHash: string): Promise<string | undefined> => {
    const content = await fetch(`https://api.github.com/repos/paritytech/polkadot/contents/Cargo.lock?ref=${commitHash}`, { headers })
      .then((d) => d.json())
      .then((data) => atob(data.content));
    return content.split("\n").find((l) => l.includes(`${GH_PARITY}/${repo}?branch`))?.split("#")[1].slice(0, -1);
  }

  useEffect(() => {
    const getReleases = async (): Promise<Release[]> => {
      const rawReleases: Release[] = await fetch('https://api.github.com/repos/paritytech/polkadot/releases', { headers })
        .then(response => response.ok ? response.json() : [])

      for (let i = 0; i < rawReleases.length; i++) {
        if (i !== (rawReleases.length - 1)) {
          rawReleases[i].prev_tag_name = rawReleases[i + 1].tag_name;
        }

        rawReleases[i].substrate_commit = "loading..";
        rawReleases[i].prev_substrate_commit = "loading..";

        rawReleases[i].pull_requests = []
      }

      setReleases(rawReleases);
      return rawReleases;
    }

    const getSubstrateCommits = async (givenReleases: Release[]) => {
      const newReleases = await Promise.all(givenReleases.map(async (r: Release) => {
        let substrate_commit = await getVersionFromCargo("substrate", r.tag_name);
        r.substrate_commit = substrate_commit!;
        return r
      }));

      for (let i = 0; i < newReleases.length; i++) {
        if (i !== newReleases.length - 1) {
          newReleases[i].prev_substrate_commit = newReleases[i + 1].substrate_commit
        }
      }

      // arrays are passed by ref.
      givenReleases = newReleases;
      setReleases(newReleases);
    };

    const getPrs = async (givenReleases: Release[]) => {
      const newReleases = await Promise.all(givenReleases.map(async (r: Release) => {
        if (r.prev_tag_name && r.prev_substrate_commit) {
          let polkadot_prs = await getPrsBetween("polkadot", r.prev_tag_name, r.tag_name);
          let substrate_prs = await getPrsBetween("substrate", r.prev_substrate_commit, r.substrate_commit);
          r.pull_requests = polkadot_prs.concat(substrate_prs);
        }
        return r
      }));

      givenReleases = newReleases;
      setReleases(newReleases);
    }


    const process = async () => {
      const fetchedReleases = await getReleases();
      await getSubstrateCommits(fetchedReleases);
      await getPrs(fetchedReleases);
    }

    process()
  }, [headers]);

  useEffect(() => {
    if (!releases) { return; }
    const filtered = releases
      .map((release) => {
        const filteredPRs = release.pull_requests.filter(pr => {
          return pr.title.includes(searchQuery) || pr.author.includes(searchQuery)
        });
        return {
          ...release,
          pull_requests: filteredPRs
        };
      })
    setFilteredReleases(filtered);
  }, [searchQuery, releases])

  return (
    <div>

      <div className="header">
        <div className="title">Polkadot Releases<span className="version">v0.0.1</span></div>

        <div className="inputWrapper">
          <input
            className="searchInput"
            type="text"
            placeholder="Search PR titles"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="body">
        {filteredReleases.map(release => {
          return (
            <div>
              <div className="releaseTitle">
                {release.name} ({release.tag_name})
              </div>
              <p><span className="label">Tag:</span> {release.prev_tag_name} ... {release.tag_name}</p>
              <p>
                <span className="label">Links:</span> {releaseLink(release.tag_name)} / {tagLink(release.tag_name)}
              </p>
              <p><span className="label">Release date:</span> {release.created_at}</p>
              <p><span className="label">Substrate tag:</span> {release.prev_substrate_commit} ... {release.substrate_commit}</p>
              <div className="prs">
                {
                  release.pull_requests?.map(pr => (
                    <div className="pr">
                      <span className="repo">[{pr.repo}]</span> PR{' '}
                      <span className="id">{pr.id}</span> by{' '}
                      <span className="author">{pr.author}</span>: {pr.title}
                    </div>
                  ))
                }
              </div>
            </div>
          );
        })}
      </div>

    </div>
  )
}