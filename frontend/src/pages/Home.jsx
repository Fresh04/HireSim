import React from 'react';

export default function Home() {
  const Link = ({ to, children, className, ...props }) => (
    <a href={to} className={className} {...props}>
      {children}
    </a>
  );

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center py-16 px-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 -right-20 w-60 h-60 bg-blue-600/10 rounded-full animate-pulse"></div>
        <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-indigo-600/10 rounded-full animate-pulse" style={{animationDelay: '2s'}}></div>
      </div>

      <div className="relative z-10 w-full max-w-5xl mx-auto text-center">
        <div className="mb-12 flex justify-center">
          <div className="w-20 h-20 bg-gray-800 rounded-xl border border-gray-700 flex items-center justify-center shadow-lg transform hover:rotate-6 transition-transform duration-500">
            <div className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
              HS
            </div>
          </div>
        </div>
        
        <h1 className="text-4xl md:text-5xl font-bold mb-6 text-white">
          Master Your Next <span className="text-blue-400">Technical Interview</span>
        </h1>
        
        <p className="mb-10 text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">
          AI-powered mock interviews that adapt to your skill level and provide 
          actionable feedback to help you land your dream job.
        </p>
        
        <div className="flex justify-center gap-4">
          <Link 
            to="/login" 
            className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Start Preparing Now
          </Link>
          <Link 
            to="/register" 
            className="px-8 py-3 text-white font-medium rounded-lg transition border border-gray-600 hover:border-gray-500 hover:bg-gray-800/50"
          >
            Create Account
          </Link>
        </div>

        <div className="mt-24">
          <h2 className="text-2xl font-bold mb-2 text-white">How It Works</h2>
          <p className="text-gray-400 mb-12 max-w-xl mx-auto">
            Our platform helps you prepare effectively with three simple steps
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {[
              { 
                icon: (
                  <svg className="w-10 h-10 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                ),
                title: "Customize", 
                desc: "Select your target role and difficulty level"
              },
              { 
                icon: (
                  <svg className="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                ),
                title: "Simulate", 
                desc: "Experience realistic interview questions"
              },
              { 
                icon: (
                  <svg className="w-10 h-10 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                ),
                title: "Improve", 
                desc: "Receive detailed feedback on your performance"
              }
            ].map((feature, index) => (
              <div 
                key={index}
                className="p-8 bg-gray-800/50 border border-gray-700 rounded-xl hover:border-gray-600 transition group"
              >
                <div className="mb-5">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">{feature.title}</h3>
                <p className="text-gray-400">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}