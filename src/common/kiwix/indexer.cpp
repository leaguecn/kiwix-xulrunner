#include "indexer.h"

namespace kiwix {

  /* Count word */
  unsigned int Indexer::countWords(const string &text) {
    unsigned int numWords = 1;
    for(unsigned int i=0; i<text.size();) {
      while(i<text.size() && text[i] != ' ') {
	i++;
      }
      numWords++;
      i++;
    }
    return numWords;
  }

  /* Constructor */
  Indexer::Indexer(const string &zimFilePath) 
    : zimFileHandler(NULL), 
      articleCount(0), 
      stepSize(0),
      keywordsBoostFactor(3) {
    
    /* Open the ZIM file */
    this->zimFileHandler = new zim::File(zimFilePath);

    /* Define a few values */
    this->firstArticleOffset = this->zimFileHandler->getNamespaceBeginOffset('A');
    this->lastArticleOffset = this->zimFileHandler->getNamespaceEndOffset('A');
    this->currentArticleOffset = this->firstArticleOffset;
    
    /* Compute few things */
    this->articleCount = this->zimFileHandler->getNamespaceCount('A');
    this->stepSize = (float)this->articleCount / (float)100;

    /* Read the stopwords file */
    //this->readStopWordsFile("/home/kelson/kiwix/moulinkiwix/stopwords/fr");
  }
  
  /* Read the file containing the stopwords */
  bool Indexer::readStopWordsFile(const string path) {
    std::string stopWord;
    std::ifstream file(path.c_str(), std::ios_base::in);

    this->stopWords.clear();

    while (getline(file, stopWord, '\n')) {
      this->stopWords.push_back(stopWord);
    }

    std::cout << "Read " << this->stopWords.size() << " lines.\n";
    return true;
  }

  /* Index next percent */
  bool Indexer::indexNextPercent(const bool &verbose) {
    float thresholdOffset = this->currentArticleOffset + this->stepSize;
    size_t found;

    /* Check if we can start */
    if (this->zimFileHandler == NULL) {
      return false;
    }

    this->indexNextPercentPre();

    while(this->currentArticleOffset < thresholdOffset && 
	  this->currentArticleOffset < this->lastArticleOffset) {

      zim::Article currentArticle;
      
      /* Get next non redirect article */
      do {
	currentArticle = this->zimFileHandler->getArticle(this->currentArticleOffset);
      } while (this->currentArticleOffset++ &&
	       currentArticle.isRedirect() && 
	       this->currentArticleOffset != this->lastArticleOffset);
      
      if (!currentArticle.isRedirect()) {
	
	/* Index the content */
	this->htmlParser.reset();
	string content (currentArticle.getData().data(), currentArticle.getData().size());

	/* The parser generate a lot of exceptions which should be avoided */
	try {
	  this->htmlParser.parse_html(content, "UTF-8", true);
	} catch (...) {
	}
	
	/* If content does not have the noindex meta tag */
	/* Seems that the parser generates an exception in such case */
	found = this->htmlParser.dump.find("NOINDEX");
	
	if (found == string::npos) {
	  string url = currentArticle.getLongUrl();
	  
	  /* Debug output */
	  if (verbose) {
	    std::cout << "Indexing " << url << "..." << std::endl;
	  }

	  this->indexNextArticle(url, 
				 this->htmlParser.title,
				 removeAccents(this->htmlParser.title), 
				 removeAccents(this->htmlParser.keywords),
				 removeAccents(this->htmlParser.dump));
	}
      }
    }

    this->indexNextPercentPost();
    
    /* increment the offset and set returned value */
    if (this->currentArticleOffset < this->lastArticleOffset) {
      this->currentArticleOffset++;
      return true;
    } else {
      this->stopIndexing();
      return false;
    }
  }

}
