import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { config } from './config.js';

// Initialize WebSocket connection
const room = new WebsimSocket();

const PuppetShowApp = () => {
    const [characters, setCharacters] = useState([]);
    const [activeTab, setActiveTab] = useState('create');
    const [newCharacter, setNewCharacter] = useState({ name: '', description: '', voice: config.voiceOptions[0].id });
    const [sceneDescription, setSceneDescription] = useState(config.defaultSceneDescription);
    const [loading, setLoading] = useState(false);
    const [curtainsOpen, setCurtainsOpen] = useState(false);
    const [stories, setStories] = useState([]);
    const [currentStory, setCurrentStory] = useState(null);
    const [dialogueInput, setDialogueInput] = useState('');
    const [currentDialogue, setCurrentDialogue] = useState(null);
    const [speakingCharacter, setSpeakingCharacter] = useState(null);
    const [showCharacterModal, setShowCharacterModal] = useState(false);
    
    const audioRef = useRef(null);
    const storyNameRef = useRef('');
    const continuationPromptRef = useRef('');

    // Load stories from database
    useEffect(() => {
        refreshStories();
    }, []);

    const refreshStories = () => {
        const storyList = room.collection('puppetStory').getList();
        setStories(storyList);
        
        room.collection('puppetStory').subscribe((updatedStories) => {
            setStories(updatedStories);
        });
    };

    const handleAddCharacter = async () => {
        if (!newCharacter.name || !newCharacter.description) {
            alert('Please provide a name and description for your character');
            return;
        }

        if (characters.length >= config.maxCharacters) {
            alert(`Maximum of ${config.maxCharacters} characters allowed`);
            return;
        }

        setLoading(true);
        
        try {
            // Generate character image using AI
            const imageResult = await websim.imageGen({
                prompt: config.imagePromptTemplate.replace('{characterDescription}', newCharacter.description),
                aspect_ratio: "2:3"
            });
            
            const character = {
                id: Date.now().toString(),
                name: newCharacter.name,
                description: newCharacter.description,
                imageUrl: imageResult.url,
                voice: newCharacter.voice
            };
            
            setCharacters([...characters, character]);
            setNewCharacter({ name: '', description: '', voice: config.voiceOptions[0].id });
            setShowCharacterModal(false);
        } catch (error) {
            console.error('Error generating character image:', error);
            alert('Error generating character image. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleOpenCurtains = () => {
        setCurtainsOpen(true);
    };

    const handleCloseCurtains = () => {
        setCurtainsOpen(false);
        setSpeakingCharacter(null);
        setCurrentDialogue(null);
    };

    const handleGenerateDialogue = async () => {
        if (characters.length < 2) {
            alert('Please add at least two characters for dialogue');
            return;
        }

        setLoading(true);
        
        try {
            let prompt = `Write a brief, fun dialogue between ${characters.map(c => c.name).join(' and ')} 
            within the scene: "${sceneDescription}". 
            The dialogue should be in this exact format:
            CHARACTER_NAME: What they say
            OTHER_CHARACTER_NAME: Their response
            
            Keep each line short (under 20 words) and make it entertaining.
            If I provided some context, use it: ${dialogueInput || "No specific context provided"}
            
            Output just the dialogue lines, without any other explanations.`;
            
            const completion = await websim.chat.completions.create({
                messages: [
                    { role: "user", content: prompt }
                ]
            });
            
            const dialogueText = completion.content;
            const dialogueLines = parseDialogue(dialogueText);
            
            if (dialogueLines.length === 0) {
                throw new Error("Failed to parse dialogue");
            }
            
            await playDialogue(dialogueLines);
            
        } catch (error) {
            console.error('Error generating dialogue:', error);
            alert('Error generating dialogue. Please try again.');
            setLoading(false);
        }
    };

    const parseDialogue = (dialogueText) => {
        const lines = dialogueText.split('\n').filter(line => line.trim());
        const dialogueLines = [];
        
        for (const line of lines) {
            // Match format "CHARACTER_NAME: Their dialogue"
            const match = line.match(/^(.+?):\s*(.+)$/);
            if (match) {
                const [_, characterName, text] = match;
                const character = characters.find(c => 
                    c.name.toLowerCase() === characterName.toLowerCase().trim()
                );
                
                if (character) {
                    dialogueLines.push({
                        characterId: character.id,
                        characterName: character.name,
                        text: text.trim(),
                        voice: character.voice
                    });
                }
            }
        }
        
        return dialogueLines;
    };

    const playDialogue = async (dialogueLines) => {
        if (!dialogueLines.length) return;
        
        for (let i = 0; i < dialogueLines.length; i++) {
            const line = dialogueLines[i];
            setCurrentDialogue(line);
            setSpeakingCharacter(line.characterId);
            
            try {
                // Generate speech for the line
                const speech = new SpeechSynthesisUtterance(line.text);
                speech.rate = config.speechRate;
                speech.voice = window.speechSynthesis.getVoices().find(v => v.name.includes(line.voice)) || null;
                
                await new Promise((resolve) => {
                    speech.onend = resolve;
                    window.speechSynthesis.speak(speech);
                    
                    // Also resolve after a timeout in case speech synthesis fails
                    setTimeout(resolve, line.text.length * 100 + 1000);
                });
                
                // Short pause between lines
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error('Error playing dialogue:', error);
            }
        }
        
        setSpeakingCharacter(null);
        setCurrentDialogue(null);
        setLoading(false);
    };

    const saveStory = async () => {
        if (!characters.length) {
            alert('Please add at least one character to save the story');
            return;
        }
        
        const storyName = prompt('Enter a name for your story:', storyNameRef.current);
        if (!storyName) return;
        
        storyNameRef.current = storyName;
        
        try {
            await room.collection('puppetStory').create({
                title: storyName,
                scene: sceneDescription,
                characters: characters,
                date: new Date().toISOString()
            });
            
            alert('Story saved successfully!');
            refreshStories();
        } catch (error) {
            console.error('Error saving story:', error);
            alert('Error saving story. Please try again.');
        }
    };

    const loadStory = async (story) => {
        setCharacters(story.characters || []);
        setSceneDescription(story.scene || config.defaultSceneDescription);
        setCurrentStory(story);
        setActiveTab('create');
    };

    const continueStory = async () => {
        if (!currentStory || !characters.length) {
            alert('Please load a story first');
            return;
        }
        
        const continuationPrompt = prompt('What should happen next in the story?', continuationPromptRef.current);
        if (!continuationPrompt) return;
        
        continuationPromptRef.current = continuationPrompt;
        setDialogueInput(continuationPrompt);
        handleGenerateDialogue();
    };

    const renderGalleryTab = () => (
        <div className={`tab-content ${activeTab === 'gallery' ? 'active' : ''}`}>
            <div className="stories-gallery">
                <h2 className="gallery-title">Story Gallery</h2>
                <div className="story-list">
                    {stories.length === 0 ? (
                        <p>No stories saved yet. Create your first puppet show!</p>
                    ) : (
                        stories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(story => (
                            <div key={story.id} className="story-card" onClick={() => loadStory(story)}>
                                <div className="story-title">{story.title}</div>
                                <div className="story-date">{new Date(story.created_at).toLocaleDateString()}</div>
                                {story.characters && story.characters[0] && (
                                    <img 
                                        className="story-thumbnail" 
                                        src={story.characters[0].imageUrl} 
                                        alt={story.characters[0].name}
                                    />
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );

    const renderCreateTab = () => (
        <div className={`tab-content ${activeTab === 'create' ? 'active' : ''}`}>
            <div className="theatre">
                <div className={`stage ${curtainsOpen ? 'curtains-open' : ''}`}>
                    <div className="stage-curtain left"></div>
                    <div className="stage-curtain right"></div>
                    
                    <div className="stage-content">
                        {characters.map(character => (
                            <div 
                                key={character.id} 
                                className={`puppet-character ${speakingCharacter === character.id ? 'puppet-speaking' : ''}`}
                            >
                                <img 
                                    className="puppet-image" 
                                    src={character.imageUrl} 
                                    alt={character.name} 
                                />
                                <div className="puppet-stick"></div>
                                <div className="puppet-name">{character.name}</div>
                                
                                {speakingCharacter === character.id && currentDialogue && (
                                    <div className="speech-bubble active">
                                        {currentDialogue.text}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
                
                {loading && (
                    <div className="loading-overlay">
                        <div className="spinner"></div>
                    </div>
                )}
            </div>
            
            <div className="controls">
                <div className="form-group">
                    <label>Scene Description:</label>
                    <textarea
                        value={sceneDescription}
                        onChange={(e) => setSceneDescription(e.target.value)}
                        placeholder="Describe your scene..."
                    ></textarea>
                </div>
                
                <div className="form-group">
                    <label>Dialogue Context (optional):</label>
                    <textarea
                        value={dialogueInput}
                        onChange={(e) => setDialogueInput(e.target.value)}
                        placeholder="Give context for dialogue generation..."
                    ></textarea>
                </div>
                
                <div className="actions">
                    <button onClick={() => setShowCharacterModal(true)}>
                        Add Character
                    </button>
                    {curtainsOpen ? (
                        <button onClick={handleCloseCurtains}>Close Curtains</button>
                    ) : (
                        <button onClick={handleOpenCurtains}>Open Curtains</button>
                    )}
                    <button onClick={handleGenerateDialogue} disabled={loading || characters.length < 2}>
                        Generate Dialogue
                    </button>
                    <button onClick={saveStory}>
                        Save Story
                    </button>
                    {currentStory && (
                        <button onClick={continueStory}>
                            Continue Story
                        </button>
                    )}
                </div>
            </div>
            
            {showCharacterModal && (
                <div className="modal">
                    <div className="modal-content">
                        <button className="modal-close" onClick={() => setShowCharacterModal(false)}>×</button>
                        <h2>Create New Character</h2>
                        <div className="form-group">
                            <label>Character Name:</label>
                            <input
                                type="text"
                                value={newCharacter.name}
                                onChange={(e) => setNewCharacter({...newCharacter, name: e.target.value})}
                                placeholder="Enter character name"
                            />
                        </div>
                        
                        <div className="form-group">
                            <label>Character Description:</label>
                            <textarea
                                value={newCharacter.description}
                                onChange={(e) => setNewCharacter({...newCharacter, description: e.target.value})}
                                placeholder="Describe your character's appearance..."
                            ></textarea>
                        </div>
                        
                        <div className="form-group">
                            <label>Voice:</label>
                            <select
                                value={newCharacter.voice}
                                onChange={(e) => setNewCharacter({...newCharacter, voice: e.target.value})}
                            >
                                {config.voiceOptions.map(voice => (
                                    <option key={voice.id} value={voice.id}>
                                        {voice.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        
                        <button onClick={handleAddCharacter} disabled={loading}>
                            {loading ? 'Generating...' : 'Create Character'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <div className="puppet-show-app">
            <div className="tabs">
                <button 
                    className={`tab ${activeTab === 'create' ? 'active' : ''}`}
                    onClick={() => setActiveTab('create')}
                >
                    Puppet Show
                </button>
                <button 
                    className={`tab ${activeTab === 'gallery' ? 'active' : ''}`}
                    onClick={() => setActiveTab('gallery')}
                >
                    Gallery
                </button>
            </div>
            
            {renderCreateTab()}
            {renderGalleryTab()}
            
            <audio ref={audioRef} style={{ display: 'none' }} />
        </div>
    );
};

ReactDOM.render(<PuppetShowApp />, document.getElementById('app'));

