import { useEffect, useState } from 'react';
import './App.scss';
import { PullRequest, Release } from './types';
import { API_GH_POLKADOT, GH_PARITY } from './consts';

console.log(import.meta.env);

const headers = import.meta.env.VITE_APP_GH_API && import.meta.env.DEV ? {
  Authorization: `Bearer ${import.meta.env.VITE_APP_GH_API}`,
} : { Authorization: `Bearer ${prompt('give me a gh token')}` }



export const App = (): JSX.Element => {
  const [releases, setReleases] = useState<Release[]>([]);
  const [filteredReleases, setFilteredReleases] = useState<Release[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  function releaseLink(tag: string): string {
    return `https://github.com/paritytech/polkadot/releases/tag/${tag}`
  }

  function tagLink(tag: string): string {
    return `https://github.com/paritytech/polkadot/tree/${tag}`
  }

  const getPRsBetween = async (repo: string, from: string, to: string): Promise<PullRequest[]> => {
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
    const content = await fetch(`${API_GH_POLKADOT}/contents/Cargo.lock?ref=${commitHash}`, { headers })
      .then((d) => d.json())
      .then((data) => atob(data.content));
    return content.split("\n").find((l) => l.includes(`${GH_PARITY} / ${repo} ? branch`))?.split("#")[1].slice(0, -1);
  }

  useEffect(() => {
    const getReleases = async (): Promise<Release[]> => {
      const rawReleases: Release[] = await fetch(`${API_GH_POLKADOT}/releases`, { headers })
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

    const getPRs = async (givenReleases: Release[]) => {
      const newReleases = await Promise.all(givenReleases.map(async (r: Release) => {
        if (r.prev_tag_name && r.prev_substrate_commit) {
          let polkadot_prs = await getPRsBetween("polkadot", r.prev_tag_name, r.tag_name);
          let substrate_prs = await getPRsBetween("substrate", r.prev_substrate_commit, r.substrate_commit);
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
      await getPRs(fetchedReleases);
    }

    process()
  }, []);

  useEffect(() => {
    if (!releases) return;

    const filtered = releases.map((release) => {
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
    <>
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
              <h2>
                {release.name} ({release.tag_name})
              </h2>
              <p>tag: {release.prev_tag_name}...{release.tag_name}</p>
              <p>
                {releaseLink(release.tag_name)} / {tagLink(release.tag_name)}
              </p>
              <p>Release date: {release.created_at}</p>
              <p>substrate tag: {release.prev_substrate_commit}...{release.substrate_commit}</p>
              {
                release.pull_requests ? release.pull_requests.map(pr => (
                  <pre>
                    [{pr.repo}] PR {pr.id} by {pr.author}: {pr.title}
                  </pre>
                )) : "..Loading"
              }
            </div>
          );
        })}
      </div>
    </>
  );
}