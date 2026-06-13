// Frontend API client for the Online Compiler IDE

const API_BASE = '/api';

// Token management
let authToken: string | null = null;

export function setToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('compiler_token', token);
  } else {
    localStorage.removeItem('compiler_token');
  }
}

export function getToken(): string | null {
  if (!authToken) {
    authToken = localStorage.getItem('compiler_token');
  }
  return authToken;
}

export function clearToken() {
  authToken = null;
  localStorage.removeItem('compiler_token');
}

// Helper for API requests
async function apiRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  return response;
}

// Auth API
export const authAPI = {
  signup: async (email: string, username: string, password: string) => {
    const res = await apiRequest('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, username, password }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Signup failed');
    }
    return res.json();
  },

  login: async (email: string, password: string) => {
    const res = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Login failed');
    }
    return res.json();
  },

  me: async () => {
    const res = await apiRequest('/auth/me');
    if (!res.ok) {
      throw new Error('Not authenticated');
    }
    return res.json();
  },
};

// Files API
export const filesAPI = {
  list: async () => {
    const res = await apiRequest('/files');
    if (!res.ok) throw new Error('Failed to fetch files');
    return res.json();
  },

  create: async (name: string, language: string, content?: string, folderId?: string | null) => {
    const res = await apiRequest('/files', {
      method: 'POST',
      body: JSON.stringify({ name, language, content, folderId: folderId || null }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create file');
    }
    return res.json();
  },

  update: async (id: string, data: { name?: string; language?: string; content?: string; folderId?: string | null }) => {
    const res = await apiRequest('/files', {
      method: 'PUT',
      body: JSON.stringify({ id, ...data }),
    });
    if (!res.ok) {
      const data2 = await res.json();
      throw new Error(data2.error || 'Failed to update file');
    }
    return res.json();
  },

  delete: async (id: string) => {
    const res = await apiRequest('/files', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete file');
    }
    return res.json();
  },
};

// Folders API
export const foldersAPI = {
  list: async () => {
    const res = await apiRequest('/folders');
    if (!res.ok) throw new Error('Failed to fetch folders');
    return res.json();
  },

  create: async (name: string, parentId?: string | null) => {
    const res = await apiRequest('/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parentId: parentId || null }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create folder');
    }
    return res.json();
  },

  update: async (id: string, data: { name?: string; parentId?: string | null }) => {
    const res = await apiRequest('/folders', {
      method: 'PUT',
      body: JSON.stringify({ id, ...data }),
    });
    if (!res.ok) {
      const data2 = await res.json();
      throw new Error(data2.error || 'Failed to update folder');
    }
    return res.json();
  },

  delete: async (id: string) => {
    const res = await apiRequest('/folders', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete folder');
    }
    return res.json();
  },
};

// Execute API
export const executeAPI = {
  execute: async (code: string, language: string, stdin?: string) => {
    const res = await apiRequest('/execute', {
      method: 'POST',
      body: JSON.stringify({ code, language, stdin }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Execution failed');
    }
    return res.json();
  },
};

// Language utilities
export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  python: '.py',
  c: '.c',
  cpp: '.cpp',
  java: '.java',
  javascript: '.js',
};

export const LANGUAGE_MONACO: Record<string, string> = {
  python: 'python',
  c: 'c',
  cpp: 'cpp',
  java: 'java',
  javascript: 'javascript',
};

export const LANGUAGE_NAMES: Record<string, string> = {
  python: 'Python',
  c: 'C',
  cpp: 'C++',
  java: 'Java',
  javascript: 'JavaScript',
};

export const DEFAULT_CODE: Record<string, string> = {
  python: `# Python Program
# Type input directly in the terminal when program is running
# Or click STDIN button to pre-provide input

def main():
    print("Hello, World!")
    
    # Interactive input - type in the terminal when prompted
    name = input("Enter your name: ")
    print(f"Hello, {name}!")

if __name__ == "__main__":
    main()
`,
  c: `#include <stdio.h>

int main() {
    printf("Hello, World!\\n");
    
    // Interactive input - type in the terminal when prompted
    int num;
    printf("Enter a number: ");
    scanf("%d", &num);
    printf("You entered: %d\\n", num);
    
    return 0;
}
`,
  cpp: `#include <iostream>
using namespace std;

int main() {
    cout << "Hello, World!" << endl;
    
    // Interactive input - type in the terminal when prompted
    int num;
    cout << "Enter a number: ";
    cin >> num;
    cout << "You entered: " << num << endl;
    
    return 0;
}
`,
  java: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
        
        // Interactive input - type in the terminal when prompted
        java.util.Scanner sc = new java.util.Scanner(System.in);
        System.out.print("Enter your name: ");
        String name = sc.nextLine();
        System.out.println("Hello, " + name + "!");
    }
}
`,
  javascript: `// JavaScript Program
function main() {
    console.log("Hello, World!");
    
    // Interactive input - type in the terminal when prompted
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question('Enter your name: ', (name) => {
        console.log("Hello, " + name + "!");
        rl.close();
        process.exit(0);
    });
}

main();
`,
};
