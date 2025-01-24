import type { MCPServer } from '../types/server';

export async function fetchMCPServers(): Promise<MCPServer[]> {
  try {
    // Use absolute path from root
    const url = '/servers.json';

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch servers: ${response.status} ${response.statusText}`);
    }
    
    // Log the response before parsing
    const text = await response.text();

    const servers = JSON.parse(text);
    return servers.sort((a, b) => b.githubStars - a.githubStars);
  } catch (error) {
    console.error('Error fetching servers:', error);
    throw error;
  }
}

export async function searchMCPServers(query: string): Promise<MCPServer[]> {
  const allServers = await fetchMCPServers();
  const searchTerms = query.toLowerCase().split(' ').filter(term => term.length > 0);
  
  return allServers.filter(server => {
    const searchText = `${server.name} ${server.description}`.toLowerCase();
    return searchTerms.every(term => searchText.includes(term));
  });
}